import test from "node:test";
import assert from "node:assert/strict";
import {findSafeLedgerCorrections} from "../src/utils/paymentLedgerPriority";
import type {Transaction} from "../src/types";
const bank = {batchId:"bank",ordinal:1,source:"icbc" as const,status:"parsed",verified:true,
  payload:{date:"2026-10-09",time:"10:00:00",account:"622200001234",amount:"-25.00",balance:"100.00"}};
const pay = {batchId:"pay",ordinal:1,source:"wechat" as const,status:"review",verified:false,
  payload:{headers:["交易时间","交易单号"],cells:["2026-10-09 10:00:00","ORDER1"]}};
const link = {bankId:"bank:1",paymentId:"pay:1",reason:"unique-card-time-channel" as const};
const txn = (id:string,note:string,amount=25):Transaction => ({id,userId:"local-user",type:"expense",amount,
  category:"消费",account:"工商银行",note,occurredAt:"2026-10-09T02:00:00Z",
  createdAt:"2026-10-09T02:00:00Z",updatedAt:"2026-10-09T02:00:00Z"});
const bankNote="工商银行流水/2026-10-09/10:00:00/622200001234/-25.00/100.00";
test("bank first, later payment: remove only proven duplicate bank ledger entry",()=>{
 const result=findSafeLedgerCorrections([link],[bank,pay],[
  txn("b",bankNote),txn("p","微信交易单号：ORDER1")]);
 assert.deepEqual(result,[{bankTransactionId:"b",paymentTransactionId:"p"}]);
});
test("single in-place upgraded transaction must not be removed",()=>{
 const result=findSafeLedgerCorrections([link],[bank,pay],[txn("b",bankNote+" · 微信交易单号：ORDER1")]);
 assert.equal(result.length,0);
});
test("ambiguous or unmatched payment order never auto deletes",()=>{
 assert.equal(findSafeLedgerCorrections([link],[bank,pay],[
 txn("b",bankNote),txn("p","微信交易单号：OTHER")]).length,0);
 assert.equal(findSafeLedgerCorrections([link],[bank,pay],[
 txn("b",bankNote),txn("b2",bankNote),txn("p","微信交易单号：ORDER1")]).length,0);
});
test("mismatched amounts cannot be removed",()=>{
 assert.equal(findSafeLedgerCorrections([link],[bank,pay],[
 txn("b",bankNote),txn("p","微信交易单号：ORDER1",40)]).length,0);
});
