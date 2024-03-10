import cron from "node-cron";
import { ethers } from "ethers";

async function createTask(winner) {
	const period = 1;
	const task = async () => {
		console.log(Date.now());
	};
	return {
		period,
		task,
	};
}

const winner = "Alice";
const task = await createTask(winner);

console.log("task.period", task.period);
console.log("task.task", task.task);

const period = 1n;
console.log("time received: ", Date.now());
cron.schedule(`*/${period} * * * *`, task.task);
