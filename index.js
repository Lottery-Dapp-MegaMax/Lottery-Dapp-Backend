import { ethers } from "ethers";
import dotenv from "dotenv";
import vault from "./Vault.json" assert { type: "json" };
import express from "express";
const app = express();
const port = 3000;

dotenv.config();

let confluxTestnetProvider,
	mumbaiPolygonProvider,
	mumbaiPolygonWallet,
	confluxTestnetWallet;
async function init() {
	mumbaiPolygonProvider = await new ethers.providers.JsonRpcProvider(
		"https://rpc-mumbai.maticvigil.com/"
	);
	mumbaiPolygonWallet = await new ethers.Wallet(
		process.env.WALLET_PRIVATE_KEY,
		mumbaiPolygonProvider
	);

	confluxTestnetProvider = await new ethers.providers.JsonRpcProvider(
		"http://127.0.0.1:8545"
	);
	confluxTestnetWallet = await new ethers.Wallet(
		process.env.WALLET_PRIVATE_KEY,
		confluxTestnetProvider
	);
}

let signer = confluxTestnetWallet;
const abi = vault.abi;

const contractVaultInConflux = new ethers.Contract(
	"0x775d85ff6d3aa949397e61de9c3a06f9d6efea47",
	abi,
	signer
);

app.get("/", (req, res) => {
	res.send(contractVaultInConflux.address);
	contractVaultInConflux.on(
		"Deposit",
		(poolAddress, sender, receiver, assets, shares) => {
			console.log(
				` ${sender} call contract Vault to deposit to ${poolAddress} with amount assets of ${assets} and ${receiver} get amount shares of ${shares}`
			);
		}
	);
	contractVaultInConflux.on(
		"Withdraw",
		(poolAddress, sender, receiver, owner, assets, shares) => {
			console.log(
				` ${sender} call contract Vault to withdraw from ${owner} at ${poolAddress} with amount assets of ${assets} and ${receiver} get amount shares of ${shares}`
			);
		}
	);
});

app.listen(port, async () => {
	await init();
	console.log(`Example app listening on port ${port}`);
});
