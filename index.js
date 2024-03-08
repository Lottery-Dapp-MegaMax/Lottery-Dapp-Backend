import { ethers } from "ethers";
import dotenv from "dotenv";
import vault from "./Vault.json" assert { type: "json" };
import pool from "./Pool.json" assert { type: "json" };
import token from "./Token.json" assert { type: "json" };
import express from "express";
import cron from "node-cron";
import bodyParser from "body-parser";
import cors from "cors";
import Queue from "bull";
dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.get("/status", (request, response) =>
	response.json({ clients: clients.length })
);

const port = 3000;
const USDT_Address_Mumbai = "0x1fde0ecc619726f4cd597887c9f3b4c8740e19e2";
const sendTxQueue = new Queue("send tx queue");
// provider and signer

const mumbaiPolygonProvider = new ethers.providers.JsonRpcProvider(
	"https://rpc-mumbai.maticvigil.com/"
);

const mumbaiPolygonWallet = new ethers.Wallet(
	process.env.WALLET_PRIVATE_KEY,
	mumbaiPolygonProvider
);

const confluxTestnetProvider = new ethers.providers.JsonRpcProvider(
	"https://evmtestnet.confluxrpc.com"
);

const confluxTestnetWallet = new ethers.Wallet(
	process.env.WALLET_PRIVATE_KEY,
	confluxTestnetProvider
);

const webSocketProvider = new ethers.providers.WebSocketProvider(
	"wss://evmtestnet.confluxrpc.com/ws"
);

// contract

const contractVaultInConflux = new ethers.Contract(
	"0x98d9945439d9736ce5120ace449363f22b413943",
	vault,
	webSocketProvider
);

const aavePoolProxyContractInMumbai = new ethers.Contract(
	"0xcc6114b983e4ed2737e9bd3961c9924e6216c704",
	pool,
	mumbaiPolygonWallet
);

const USDT_Token_Mumbai = new ethers.Contract(
	USDT_Address_Mumbai,
	token,
	mumbaiPolygonWallet
);

USDT_Token_Mumbai.approve(
	aavePoolProxyContractInMumbai.address,
	Number(await USDT_Token_Mumbai.balanceOf(mumbaiPolygonWallet.address))
);

contractVaultInConflux.on("_Deposit", async (poolAddress, receiver, assets) => {
	console.log("First parameter: ", poolAddress);
	console.log("Third parameter: ", receiver);
	console.log("Four parameter: ", Number(assets));

	await sendTxQueue.add({ poolAddress, receiver, assets });
});

// Array to hold connections
let clients = [];
let txs = [];

function eventsHandler(request, response, next) {
	console.log("have connection");
	const headers = {
		"Content-Type": "text/event-stream",
		Connection: "keep-alive",
		"Cache-Control": "no-cache",
	};
	response.writeHead(200, headers);

	const data = `data: ${JSON.stringify(txs)}\n\n`;

	response.write(data);

	const clientId = Date.now();

	const newClient = {
		id: clientId,
		response,
	};

	clients.push(newClient);

	request.on("close", () => {
		console.log(`${clientId} Connection closed`);
		clients = clients.filter((client) => client.id !== clientId);
	});
}

app.get("/events", eventsHandler);

function sendEventsToAll(newTxs) {
	clients.forEach((client) =>
		client.response.write(`data: ${JSON.stringify(newTxs)}\n\n`)
	);
}

sendTxQueue.process(async (job, done) => {
	const success = await aavePoolProxyContractInMumbai.supply(
		USDT_Address_Mumbai,
		job.data.assets,
		job.data.receiver,
		0
	);
	txs.push(success.hash);
	sendEventsToAll(success.hash);
	console.log("done\n");
	done();
});

app.get("/", (req, res) => {
	res.send(contractVaultInConflux.address);
});

app.listen(port, async () => {
	console.log(`Txs Events service listening at http://localhost:${port}`);
});
