import { ethers } from "ethers";
import dotenv from "dotenv";
import PoolManager from "./PoolManager.json" assert { type: "json" };
import Proxy from "./Proxy.json" assert { type: "json" };
import token from "./Token.json" assert { type: "json" };
import Pool from "./Pool.json" assert { type: "json" };

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
const APoolUSDT_Address_Mumbai = "0x5F3a71D07E95C1E54B9Cc055D418a219586A3473";
const sendTxQueue = new Queue("send tx queue");
// provider and signer

const mumbaiPolygonProvider = new ethers.providers.JsonRpcProvider(
	process.env.POLYGON_RPC_URL
);

const mumbaiPolygonWallet = new ethers.Wallet(
	process.env.WALLET_PRIVATE_KEY,
	mumbaiPolygonProvider
);

const confluxTestnetProvider = new ethers.providers.JsonRpcProvider(
	process.env.CONFLUX_RPC_URL
);

const confluxTestnetWallet = new ethers.Wallet(
	process.env.WALLET_PRIVATE_KEY,
	confluxTestnetProvider
);

const webSocketProvider = new ethers.providers.WebSocketProvider(
	process.env.CONFLUX_RPC_WS
);

// contract

const poolManagerContract_ConfluxTestnet = new ethers.Contract(
	"0xAF1F6e3431203B2d8fDF754E5BA9aE17ba6AFea7",
	PoolManager,
	webSocketProvider
);

const aavePoolProxyContractInMumbai = new ethers.Contract(
	"0xcc6114b983e4ed2737e9bd3961c9924e6216c704",
	Proxy,
	mumbaiPolygonWallet
);

const USDT_Token_Mumbai = new ethers.Contract(
	USDT_Address_Mumbai,
	token,
	mumbaiPolygonWallet
);

const APoolUSDT_Token_Mumbai = new ethers.Contract(
	APoolUSDT_Address_Mumbai,
	token,
	mumbaiPolygonWallet
);

USDT_Token_Mumbai.approve(
	aavePoolProxyContractInMumbai.address,
	Number(await USDT_Token_Mumbai.balanceOf(mumbaiPolygonWallet.address))
);

poolManagerContract_ConfluxTestnet.on(
	"_Deposit",
	async (poolAddress, receiver, assets, txInfo) => {
		console.log("Event _Deposit");
		console.log("First parameter: ", poolAddress);
		console.log("Second parameter: ", receiver);
		console.log("Third parameter: ", Number(assets));
		console.log("TxInfo: ", txInfo);
		const numberOfAssets = assets / 10 ** 12;
		await sendTxQueue.add({
			poolAddress,
			receiver,
			numberOfAssets,
			type: "deposit",
		});
	}
);

poolManagerContract_ConfluxTestnet.on(
	"_Withdraw",
	async (poolAddress, receiver, assets, txInfo) => {
		console.log("Event _Withdraw");
		console.log("First parameter: ", poolAddress);
		console.log("Second parameter: ", receiver);
		console.log("Third parameter: ", Number(assets));
		const numberOfAssets = assets / 10 ** 12;
		await sendTxQueue.add({
			poolAddress,
			receiver,
			numberOfAssets,
			type: "withdraw",
		});
	}
);

let Counter = {};
let LastBalance = {};

async function createTask(poolAddress) {}

poolManagerContract_ConfluxTestnet.on(
	"_Draw",
	async (poolAddress, numDrawBefore) => {
		console.log("Event _Draw");
		console.log("First parameter: ", poolAddress);
		console.log("Second parameter: ", numDrawBefore);
		await sendTxQueue.add({
			poolAddress,
			currentDraw: numDrawBefore.toString(),
			type: "draw",
		});
	}
);

poolManagerContract_ConfluxTestnet.on(
	"_EarnPrize",
	async (poolAddress, player, prize) => {
		console.log("Event _EarnPrize");
		console.log("First parameter: ", poolAddress);
		console.log("Second parameter: ", player);
		console.log("Third parameter: ", prize);
		await sendTxQueue.add({
			poolAddress,
			player,
			prize,
			type: "earn",
		});
	}
);

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
	if (job.data.type == "deposit") {
		const success = await aavePoolProxyContractInMumbai.supply(
			USDT_Address_Mumbai,
			job.data.numberOfAssets,
			mumbaiPolygonWallet.address,
			0
		);
		await success.wait();
		console.log("deposit");
		const tx = { txHash: success.hash, type: "deposit" };
		txs.push(tx);
		sendEventsToAll(tx);
	} else if (job.data.type == "withdraw") {
		const success = await aavePoolProxyContractInMumbai.withdraw(
			USDT_Address_Mumbai,
			job.data.numberOfAssets,
			mumbaiPolygonWallet.address
		);
		await success.wait();
		console.log("withdraw");
		const tx = { txHash: success.hash, type: "withdraw" };
		txs.push(tx);
		sendEventsToAll(tx);
	} else if (job.data.type == "draw") {
		const tx = {
			poolAddress: job.data.poolAddress,
			currentDraw: job.data.currentDraw,
			type: "draw",
		};
		txs.push(tx);
		sendEventsToAll(tx);
	} else if (job.data.type == "earn") {
		const tx = {
			poolAddress: job.data.poolAddress,
			player: job.data.player,
			prize: job.data.prize,
			type: "earn",
		};
		txs.push(tx);
		sendEventsToAll(tx);
	}
	done();
});

app.get("/", (req, res) => {
	res.send(contractVaultInConflux.address);
});

app.listen(port, async () => {
	console.log(`Txs Events service listening at http://localhost:${port}`);
});
