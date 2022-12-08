import * as functions from "firebase-functions";
import { ethers } from "ethers";
import * as contractABI from "./abi/contractABI.json";
import * as TokenLdgABI from "./abi/ldgTokenABI.json";

import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

const providerLink = "";
const ldgContractAddress = "";
const ldgTokenAddress = "";

// SCHEDULE STATS USER FOR CHART

export const schedule_addStatsUser = functions.pubsub
  .schedule("0 * * * *")
  .onRun(async (context) => {
    const provider = new ethers.providers.WebSocketProvider(providerLink);
    const ldgContract = new ethers.Contract(
      ldgContractAddress,
      contractABI.abi,
      provider
    );
    const ldgToken = new ethers.Contract(
      ldgTokenAddress,
      TokenLdgABI.abi,
      provider
    );

    let res = await ldgContract.myPrice();
    const ldgTokenPrice = parseInt(res._hex, 16);

    let stats = {
      portfolio_value: 0,
      token_price: ldgTokenPrice,
      created: new Date(Date.now()),
    };

    const userRef = db.collection("user");
    let allUser = await userRef.get();

    allUser.forEach(async (doc) => {
      res = await ldgToken.balanceOf(doc.id);
      stats.portfolio_value =
        (parseInt(res._hex, 16) * stats.token_price) / 10 ** 6;
      await db
        .collection("user")
        .doc(doc.id)
        .collection("stats")
        .doc()
        .set(stats);
    });

    return null;
  });

// SCHEDULE PERF MONTHS

export const schedule_perfMonths = functions.pubsub
  .schedule("0 0 1 1-12 *")
  .timeZone("Europe/Paris")
  .onRun(async () => {
    const userRef = db.collection("user");
    let allUser = await userRef.get();
    let monthly_revenue = {
      perfMonths: 0,
      purcentageMonths: 0,
      oldTokenPrice: 0,
    };

    allUser.forEach(async (doc1) => {
      // For in all user address
      forInTrx(doc1, monthly_revenue);
    });

    return null;
  });

// SCHEDULE STATS TOKEN PRICE FOR CHART

export const schedule_statsTokenPrice = functions.pubsub
  .schedule("0 * * * *")
  .onRun(async () => {
    const provider = new ethers.providers.WebSocketProvider(providerLink);
    const ldgContract = new ethers.Contract(
      ldgContractAddress,
      contractABI.abi,
      provider
    );

    let res = await ldgContract.myPrice();
    const ldgTokenPrice = parseInt(res._hex, 16);
    console.log("LEDGITY TOKEN PRICE :", ldgTokenPrice);

    let stats = {
      token_price: ldgTokenPrice,
      created: new Date(Date.now()),
    };
    await db.collection("stats_token").doc().set(stats);

    return null;
  });

const forInTrx = async (
  doc1: any,
  monthly_revenue: {
    perfMonths: number;
    purcentageMonths: number;
    oldTokenPrice: number;
  }
) => {
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  let trxValue = {
    bal: 0,
    oldDate: 0,
    currentDate: 0,
  };
  let check = false; // to check if there is another deposit or withdraw after the first one
  let i = { i: 0 }; // to check if it's the last deposit / withdraw

  const trx = await db
    .collection("user")
    .doc(doc1.id)
    .collection("trx")
    .orderBy("created", "asc")
    .get();
  trx.forEach(async (doc2) => {
    // for in all transactions (deposit with) to know the total balance of the user
    let checkTheMonth =
      new Date(doc2.data().created._seconds * 1000).getMonth() + 1;
    if (checkTheMonth === currentMonth) {
      if (trx.size === 1) {
        trxValue.bal = doc2.data().balance;
        await if_one_transc(
          trxValue,
          doc2,
          doc1,
          currentMonth,
          monthly_revenue
        );
        await addMonthlyToDB(doc1, currentMonth, currentYear, monthly_revenue);
        return;
      } else if (check === true) {
        await forInStats(
          trxValue,
          doc2,
          doc1,
          currentMonth,
          i,
          trx,
          monthly_revenue
        );
      } else if (check === false) {
        // there is another depo/with after that so we keep in memory the balance and the old date
        i.i++;
        trxValue.bal = doc2.data().balance;
        trxValue.oldDate = doc2.data().created._seconds;
        check = true;
      }
    }
    if (i.i === trx.size) {
      await addMonthlyToDB(doc1, currentMonth, currentYear, monthly_revenue);
    }
  });
};

const if_one_transc = async (
  trxValue: { bal: number; oldDate: number; currentDate: number },
  doc2: any,
  doc1: any,
  currentMonth: number,
  monthly_revenue: {
    perfMonths: number;
    purcentageMonths: number;
    oldTokenPrice: number;
  }
) => {
  trxValue.currentDate = doc2.data().created._seconds;
  const stats = await db
    .collection("user")
    .doc(doc1.id)
    .collection("stats")
    .orderBy("created", "asc")
    .get();
  stats.forEach(async (doc3) => {
    // for in the stats of the user portfolio
    let checkTheMonth =
      new Date(doc3.data().created._seconds * 1000).getMonth() + 1;
    if (
      checkTheMonth === currentMonth &&
      trxValue.currentDate <= doc3.data().created._seconds
    ) {
      if (monthly_revenue.oldTokenPrice != 0) {
        monthlyRevenueCalculate(doc3, trxValue, monthly_revenue);
      }
      monthly_revenue.oldTokenPrice = doc3.data().token_price;
    }
  });
};

const forInStats = async (
  trxValue: { bal: number; oldDate: number; currentDate: number },
  doc2: any,
  doc1: any,
  currentMonth: number,
  i: any,
  trx: any,
  monthly_revenue: {
    perfMonths: number;
    purcentageMonths: number;
    oldTokenPrice: number;
  }
) => {
  trxValue.currentDate = doc2.data().created._seconds;

  const stats = await db
    .collection("user")
    .doc(doc1.id)
    .collection("stats")
    .orderBy("created", "asc")
    .get();

  stats.forEach((doc3) => {
    // for in the stats of the user portfolio
    let checkTheMonth =
      new Date(doc3.data().created._seconds * 1000).getMonth() + 1;
    if (
      checkTheMonth === currentMonth &&
      doc3.data().created._seconds > trxValue.oldDate &&
      doc3.data().created._seconds <= trxValue.currentDate
    ) {
      if (monthly_revenue.oldTokenPrice != 0) {
        monthlyRevenueCalculate(doc3, trxValue, monthly_revenue);
      }
      monthly_revenue.oldTokenPrice = doc3.data().token_price;
    }
  });
  trxValue.oldDate = trxValue.currentDate;
  trxValue.bal = doc2.data().balance;
  i.i++;
  if (i.i === trx.size)
    await if_one_transc(trxValue, doc2, doc1, currentMonth, monthly_revenue);
};

const monthlyRevenueCalculate = async (
  doc3: any,
  trxValue: { bal: number; oldDate: number; currentDate: number },
  monthly_revenue: {
    perfMonths: number;
    purcentageMonths: number;
    oldTokenPrice: number;
  }
) => {
  let resPerf =
    (doc3.data().token_price * trxValue.bal) / (1 * 10 ** 6) -
    (monthly_revenue.oldTokenPrice * trxValue.bal) / (1 * 10 ** 6);
  monthly_revenue.perfMonths += resPerf;
  let resPurcentage =
    ((doc3.data().token_price * trxValue.bal -
      monthly_revenue.oldTokenPrice * trxValue.bal) /
      (monthly_revenue.oldTokenPrice * trxValue.bal)) *
    100;
  monthly_revenue.purcentageMonths += resPurcentage;
  monthly_revenue.oldTokenPrice = doc3.data().token_price;
};

const addMonthlyToDB = async (
  doc: any,
  currentMonth: number,
  currentYear: number,
  monthly_revenue: {
    perfMonths: number;
    purcentageMonths: number;
    oldTokenPrice: number;
  }
) => {
  await db
    .collection("user")
    .doc(doc.id)
    .collection("monthly_revenue")
    .doc()
    .set({
      year: currentYear,
      month: currentMonth,
      performance: monthly_revenue.perfMonths,
      purcentage: monthly_revenue.purcentageMonths,
    });
};