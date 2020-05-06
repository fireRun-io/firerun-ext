const functions = require("firebase-functions");
const moment = require("moment");
const fetch = require("node-fetch");
const monitoring = require("@google-cloud/monitoring");
const Rollbar = require("rollbar");

const PROD = false;

console.log(process.env.ROLLBAR === "true");

const rollbar = new Rollbar({
      accessToken: "335a7994494d43db86c9a8149689692e",
      captureUncaught: true,
      captureUnhandledRejections: true,
      payload: {
        environment: PROD ? "production" : "development",
      },
      enabled: process.env.ROLLBAR === "true",
    });

let apiCalls, apiMap;

let EXT_ADD_URL, EXT_YESTERDAY_URL, EXT_API_CONFIG_URL;
if (PROD) {
  EXT_ADD_URL =
    "https://us-central1-firerun.cloudfunctions.net/api/ext-data-add";
  EXT_YESTERDAY_URL =
    "https://us-central1-firerun.cloudfunctions.net/api/ext-has-yesterday";
  EXT_API_CONFIG_URL =
    "https://us-central1-firerun.cloudfunctions.net/api/ext-api-config";
} else {
  EXT_ADD_URL = "http://localhost:5002/firerun/us-central1/api/ext-data-add";
  EXT_YESTERDAY_URL =
    "http://localhost:5002/firerun/us-central1/api/ext-has-yesterday";
  EXT_API_CONFIG_URL =
    "http://localhost:5002/firerun/us-central1/api/ext-api-config";
}

const getInterval = (min, yesterday, month, lessDays = 1) => {
  let start;
  const utc = new Date();
  if (month) {
    const date = new Date(utc.toUTCString());
    start = new Date(date.getFullYear(), date.getMonth(), 1);
  } else {
    start = new Date(utc.toUTCString());
    start.setDate(start.getDate() - lessDays); // use -1 for yesterday  // put back
  }

  start.setHours(0, 0, 0, 0); // Set to midnight
  start.setHours(start.getHours() + 3);

  const end = new Date(utc.toUTCString());
  end.setDate(end.getDate() - lessDays); //  -1 as yesterday at 11:59 // put back
  end.setHours(23, 59, 59, 999); // put back
  end.setHours(end.getHours() + 3); // put back

  const interval = {
    startTime: {
      seconds: yesterday || month ? start / 1000 : Date.now() / 1000 - 60 * min,
    },
    endTime: {
      seconds: yesterday || month ? end / 1000 : Date.now() / 1000,
    },
  };

  return interval;
};

const checkOverage = (call) => {
  const callReturn = { ...call };

  callReturn.overageCost = 0;

  // check Overage
  if (callReturn.limit !== null && callReturn.limit !== undefined) {
    const diff = callReturn.limit - callReturn.totalUsage;

    /*
    if (callReturn.key === "firestore_read") {
      console.log("\n--------------");
      console.log("Key: " + callReturn.key);
      console.log("Limit: " + callReturn.limit);
      console.log("Total Usage: " + callReturn.totalUsage);
      console.log("Diff: " + diff);
    }
    */

    if (diff > 0) {
      callReturn.remainingLimit = diff;
    } else {
      // const absDiff = Math.abs(diff);

      const absDiff = callReturn.totalUsage;
      callReturn.overageDiff = absDiff;

      // console.log("Abs Diff: " + absDiff);

      if (callReturn.overage && callReturn.overage_per) {
        const cost = (absDiff / callReturn.overage_per) * callReturn.overage;

        callReturn.overageCost = cost;
      }
    }
  }

  return callReturn;
};

const getTotalUsage = (call, descriptor, record, total) => {
  const usage = parseFloat(
    descriptor.metricKind === "DELTA"
      ? total
      : record.length > 0
      ? record[record.length - 1][1]
      : 0
  );

  const calc = call.divideBy ? usage / call.divideBy : usage;

  return calc;
};

const getData = async (call, client, projectId, lessDays = 1) => {
  console.log(`Getting Data for ${projectId} : ${call.key}`);

  const uri = `${apiMap.get(call.type)}${call.uri}`;
  const filter = `metric.type="${uri}"`;

  const request = {
    name: client.metricDescriptorPath(projectId, uri),
  };

  const tempDes = await client.getMetricDescriptor(request).catch((err) => {
    const msg = `Metrics Error: ${err} : Project: ${projectId} : Call: ${call.key}`;
    console.error("-----------------");
    console.error(msg);
    console.error("-----------------");

    return false;
  });

  if (!tempDes) {
    console.error(`Final ERROR: ${projectId} : ${call.key}`);
    return null;
  } else {
    console.log(`Completed Call ${call.key}`);
  }

  const [descriptor] = tempDes;

  // Writes time series data
  let total = 0;
  let previousDayTotal = 0;
  const record = [];

  const interval = getInterval(null, true, false, lessDays);

  const requestTS = {
    name: client.projectPath(projectId),
    filter,
    interval,
    view: "FULL",
  };

  const ts = await client.listTimeSeries(requestTS).catch((err) => {
    const msg = `Timeseries Error for ${user.projectId} and uid: ${user.uid} and email: ${user.email} with ${err}`;
    console.error(msg);
  });

  if (!ts) {
    console.error(
      `TimeSeries Error from listTimeSeries ${user.projectId} and uid: ${
        user.uid
      } and email: ${user.email}: ${JSON.stringify(ts, null, 2)}`
    );
    return null;
  }

  const [timeSeries] = ts;
  timeSeries.forEach((data) => {
    /*
      console.log("Timeseries: " + call.key);
    if (call.key === "cloudstorage_requests") {
      // console.log('Call Agg: ' + call.aggregate);
      console.log("Points: " + JSON.stringify(data, null, 2));
    }*/

    if (!call.method || call.method === data.metric.labels.method) {
      // exit if don't want to aggregate the data
      data.points.every((point, i) => {
        let val = point.value[point.value.value];
        if (point.value.value === "distributionValue") {
          const tmp = parseFloat(val.mean);
          val = !isNaN(tmp) ? tmp : 0;
        }

        record.push([interval.endTime.seconds - i * call.interval, val]);
        total += parseFloat(val);

        return !(i === 0 && !call.aggregate);
      });
    }
  });

  interval.startTime.date = new moment(
    interval.startTime.seconds * 1000
  ).format("MM/DD/YYYY h:mm a");
  interval.endTime.date = new moment(interval.endTime.seconds * 1000).format(
    "MM/DD/YYYY h:mm a"
  );

  let callReturn = {
    name: call.name ? call.name : descriptor.displayName,
    description: descriptor.description,
    url: descriptor.type,
    ...call,
    kind: descriptor.metricKind,
    unit: descriptor.unit,
    valueType: descriptor.valueType,
    totalUsage: getTotalUsage(call, descriptor, record, total), // if GAUGE, get the last value
    interval,
  };

  // check Overage
  callReturn = checkOverage(callReturn);

  return callReturn;
};

const formatDate = (lessDays = 1, lessMonths) => {
  const date = new Date();
  date.setDate(date.getDate() - lessDays);

  let month = date.getMonth() + 1;
  month = month < 10 ? `0${month}` : month;
  let day = date.getDate();
  day = day < 10 ? `0${day}` : day;
  let year = date.getFullYear();

  const returnDate = [year, month, day].join("-");

  return returnDate;
};

const quickStart = async (req, res) => {
  !PROD && console.log("Environment: Development");

  const { EMAIL, TOKEN, PROJECT_ID, EXT_INSTANCE_ID } = process.env;

  console.log(`Project ID: ${PROJECT_ID} Install ID: ${EXT_INSTANCE_ID}`);
  PROD && rollbar.info("Started processing extension: " + PROJECT_ID);

  let client;
  if (!PROD) {
    const credentials = require("./credentials.json");

    const metricsOptions = {
      projectId: PROJECT_ID,
      credentials,
    };

    client = new monitoring.MetricServiceClient(metricsOptions);
  } else {
    client = new monitoring.MetricServiceClient();
  }

  const apiResults = await fetch(EXT_API_CONFIG_URL)
    .then((result) => result.json())
    .catch(console.error);

  apiCalls = apiResults.apiCalls;
  apiMap = new Map(apiResults.apiMap);

  const hasYesterday = await fetch(EXT_YESTERDAY_URL, {
    method: "post",
    body: JSON.stringify({
      token: TOKEN,
      email: EMAIL,
      projectId: PROJECT_ID,
      installId: EXT_INSTANCE_ID,
    }),
    headers: { "Content-Type": "application/json" },
  })
    .then((result) => result.json())
    .catch(console.error);

  if (hasYesterday) {
    let body;
    for (i = hasYesterday.limDate; i > 0; i--) {
      const data = await Promise.all(
        apiCalls.map(async (call) => await getData(call, client, PROJECT_ID, i))
      );

      body = {
        email: EMAIL,
        date: formatDate(i),
        projectId: PROJECT_ID,
        token: TOKEN,
        installId: EXT_INSTANCE_ID,
        data,
      };

      await fetch(EXT_ADD_URL, {
        method: "post",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }).catch(console.error);
    }

    res && res.send(JSON.stringify(body, null, 2));
    return "";
  } else {
    res && res.send("Error");
    PROD && rollbar.info("Extension does not have yesterday " + PROJECT_ID);

    return "";
  }
};

exports.scheduledFirerunExt = functions.handler.pubsub.schedule.onRun(
  (message, context) => {
    console.log("Scheduled QuickStart");
    return quickStart();
  }
);

exports.httpFirerun = functions.handler.https.onRequest((req, res) => {
  console.log("HTTPS QuickStart");
  quickStart();
  res.send("Done");
});
