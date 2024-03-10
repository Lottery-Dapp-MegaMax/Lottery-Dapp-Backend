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
	"0x27C8e580552E35EF1171A7562ae14e0D02dcb290",
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
	async (poolAddress, receiver, assets) => {
		console.log("First parameter: ", poolAddress);
		console.log("Second parameter: ", receiver);
		console.log("Third parameter: ", Number(assets));
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
	async (poolAddress, receiver, assets) => {
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

async function createTask(poolAddress) {
	const pool = new ethers.Contract(poolAddress, Pool, confluxTestnetWallet);
	const period = await pool.period();
	Counter[poolAddress] = 0;
	const task = async () => {
		console.log("date now: ", Date.now());
		const drawTimes = await pool.drawTimes();
		if (Counter[poolAddress] != drawTimes - 2) {
			console.log("no more draw");
			return;
		}
		console.log("Counter[poolAddress]", Counter[poolAddress]);
		console.log("drawTimes", drawTimes);
		{
			Counter[poolAddress] += 1;
			const depositors =
				await poolManagerContract_ConfluxTestnet.getDepositorsInPool(
					poolAddress,
					await pool.getStartTime(Counter[poolAddress]),
					await pool.getEndTime(Counter[poolAddress])
				);
			const currentBalance = await APoolUSDT_Token_Mumbai.balanceOf(
				mumbaiPolygonWallet.address
			);
			const totalPrize = currentBalance - LastBalance[poolAddress];
			const winner = await pool.getWinner(depositors, totalPrize);
			console.log("doing task");
			console.log(winner);
		}
	};
	return {
		period,
		task,
	};
}

poolManagerContract_ConfluxTestnet.on("AddNewPool", async (poolAddress) => {
	console.log("time received: ", Date.now());
	console.log("First parameter: ", poolAddress);
	const task = await createTask(poolAddress);
	console.log("task.period", task.period);
	console.log("task.task", task.task);
	const period = task.period / 60 / 2;
	// let now = new Date();
	// let currentMinute = now.getMinutes();
	// let currentHour = now.getHours();
	// cron.schedule(`${currentMinute} ${currentHour} */${period} * *`, task.task);
	setTimeout(() => {
		cron.schedule(`*/${period} * * * *`, task.task);
	}, 20000);
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
	if (job.data.type == "deposit") {
		const success = await aavePoolProxyContractInMumbai.supply(
			USDT_Address_Mumbai,
			job.data.numberOfAssets,
			job.data.receiver,
			0
		);
		await success.wait();
		const txHash = success.hash;
		txs.push({ txHash, type: "deposit" });
		sendEventsToAll(success.hash);
	} else {
		const success = await aavePoolProxyContractInMumbai.withdraw(
			USDT_Address_Mumbai,
			job.data.numberOfAssets,
			job.data.receiver,
			0
		);
		await success.wait();
		const txHash = success.hash;
		txs.push({ txHash, type: "withdraw" });
		sendEventsToAll(success.hash);
	}
	done();
});

app.get("/", (req, res) => {
	res.send(contractVaultInConflux.address);
});

app.listen(port, async () => {
	console.log(`Txs Events service listening at http://localhost:${port}`);
});
