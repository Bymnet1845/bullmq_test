import { Queue, Worker } from "bullmq";
import * as dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();
const MISSKEY_ACCESS_TOKEN = process.env.MISSKEY_ACCESS_TOKEN;

const mysqlPool = mysql.createPool({
	host: process.env.MYSQL_HOST,
	user: process.env.MYSQL_USER,
	password: process.env.MYSQL_PASSWORD,
	database: process.env.MYSQL_DATABASE,
	supportBigNumbers: true,
	bigNumberStrings: true,
	namedPlaceholders: true,
	connectionLimit: 1,
});

const TEST_QUEUE = new Queue("test_2026-03-10-04-34");

const TEST_WORKER = new Worker(
	"test_2026-03-10-04-34",
	async (job) => {
		try {
			const [users, fields] = await mysqlPool.query(`SELECT * FROM users WHERE id=:id`, { id: job.data.id });
			const result = await getActivities(users[0].niconico_id);
			
			for (let activity of result.activities) {
				if (activity.id === users[0].last_acquired_activity_id) break;
				await post(activity, users[0].misskey_host, users[0].misskey_access_token);
			}

			await mysqlPool.query(`UPDATE users SET last_acquired_activity_id=:activityId WHERE id=:userId`, { activityId: result.activities[0].id, userId: job.data.id });
		} catch (error) {
			console.error(error);
			return;
		}
	},
	{ 
		connection: { host: "localhost", port: 6379 },
		limiter: { max: 1, duration: 1000, },
	}
);

await TEST_QUEUE.obliterate({ force: true }).then(async () => {
	try {
		const [users] = await mysqlPool.query("SELECT id FROM users");

		users.forEach((user) => {
			TEST_QUEUE.add(`test_${user.id}_${Date.now()}_0`, { id: user.id }, { repeat: { every: 60000 }, connection: { host: "localhost", port: 6379 }});
		});
	} catch (error) {
		console.error(error);
		return;
	}
});

async function getActivities(userId) {
	return await fetch(`https://api.feed.nicovideo.jp/v1/activities/actors/users/${userId}/all?context=user_timeline_${userId}`, {
		method: "GET",
		headers: {
			"User-Agent": "OtomadSite/20260216 (Minegumo Productions; Bymnet1845 <bymnet1845@haraheri5ro.com>)",
			"X-Frontend-Id": 70,
			"X-Frontend-Version": 0
		}
	}).then((response) => {
		return response.json();
	});
}

async function post(activity, host, accessToken) {
	await fetch(`https://${host}/api/notes/create`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			i: accessToken,
			text: `テスト\n${activity.message.text}\n${activity.content.title} ${activity.content.url} #ニコニコ動画 #${activity.content.id}`,
			visibility: "specified"
		})
	})
}