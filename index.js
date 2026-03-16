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
			const [users] = await mysqlPool.query(`SELECT * FROM users WHERE id=:id`, { id: job.data.id });

			if (users.length === 0) {
				// 繰り返しジョブを削除する処理？←そんなのあんの？
				return;
			}

			const lastAcquiredActivityId = users[0]["last_acquired_activity_id"];
			const lastAcquiredActivityTime = users[0]["last_acquired_activity_time"];
			const niconicoUserId = users[0]["niconico_id"];
			let done = false;
			let activities = new Array();
			let activityCursorId;
			let lastPostedActivity;

			while (!done) {
				const activitiesApiResult = await getActivities(niconicoUserId, activityCursorId);

				for (let i = 0; i < activitiesApiResult.activities.length; i++) {
					const activity = activitiesApiResult.activities[i];

					if (activity.id === lastAcquiredActivityId || new Date(activity.createdAt).getTime() < lastAcquiredActivityTime) {
						done = true;
						continue;
					}

					activities.unshift(activity);
				}

				activityCursorId = activitiesApiResult.nextCursor;
			}

			if (activities.length > 0) {
				for (let i = 0; i < activities.length; i++) {
					await post(activities[i], users[0]["misskey_host"], users[0]["misskey_access_token"]);
					lastPostedActivity = activities[i];
				}

				await mysqlPool.query(`UPDATE users SET last_acquired_activity_id=:activityId, last_acquired_activity_time=:activityTime WHERE id=:userId`, { activityId: lastPostedActivity.id, activityTime: new Date(lastPostedActivity.createdAt).getTime(), userId: job.data.id });
			}
		} catch (error) {
			console.error(error);
			throw new Error(error);
		}
	}, { 
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
		throw new Error(error);
	}
});

async function getActivities(userId, cursorId) {
	let activityApiUrl = `https://api.feed.nicovideo.jp/v1/activities/actors/users/${userId}/all?context=user_timeline_${userId}`;
	if (cursorId) activityApiUrl += `&cursor=${cursorId}`;

	return await fetch(activityApiUrl, {
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