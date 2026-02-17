import { Queue, Worker } from "bullmq";
import * as dotenv from "dotenv";
import mysql from "mysql";

dotenv.config();
const MISSKEY_ACCESS_TOKEN = process.env.MISSKEY_ACCESS_TOKEN;

const MYSQL_CONNECTION = mysql.createConnection({
	host: process.env.MYSQL_HOST,
	user: process.env.MYSQL_USER,
	password: process.env.MYSQL_PASSWORD,
	database: process.env.MYSQL_DATABASE,
	supportBigNumbers: true,
	bigNumberStrings: true
});

const TEST_QUEUE = new Queue("test_2026-02-16-20-23");

const TEST_WORKER = new Worker(
	"test_2026-02-16-20-23",
	async (job) => {
		MYSQL_CONNECTION.query(`SELECT * FROM users WHERE id=${job.data.id};`, async (error, users, fields) => {
			if (error) {
				console.error(error);
				return;
			}

			const RESULT = await getActivities(users[0].niconico_id);

			for (let activity of RESULT.activities) {
				if (activity.id === users[0].last_acquired_activity_id) break;
				await post(activity, users[0].misskey_host, users[0].misskey_access_token);
			};

			MYSQL_CONNECTION.query(`UPDATE users SET last_acquired_activity_id="${RESULT.activities[0].id}" WHERE id=${job.data.id};`, (error, results, fields) => { if (error) console.error(error); });
		});
	},
	{ connection: { host: "localhost", port: 6379 }}
);

await TEST_QUEUE.obliterate().then(() => {
	MYSQL_CONNECTION.query("SELECT id FROM users;", (error, users, fields) => {
		if (error) {
			console.error(error);
			return;
		}

		users.forEach((user) => {
			TEST_QUEUE.add(`test_${user.id}_${Date.now()}`, { id: user.id }, { repeat: { every: 300000 }, connection: { host: "localhost", port: 6379 }});
		});
	});
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
			visibility: "home"
		})
	})
}