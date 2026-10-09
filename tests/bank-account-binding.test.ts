import test from "node:test";
import assert from "node:assert/strict";
import {canBindStatementAccount, statementAccountFromSourceId} from "../src/utils/bankAccountBinding";
test("ICBC provenance marker identifies PDF account independent of UI labels",()=>{
 assert.equal(statementAccountFromSourceId("工商银行流水/2026-06-02/10:00:00/622200005983/-2.00/100.00"),"622200005983");
 assert.equal(statementAccountFromSourceId("微信交易单号：123"),"");
});
test("same last4 binds automatically",()=>{
 assert.equal(canBindStatementAccount("622200005983","5983",false),true);
});
test("mismatch cannot silently reassign",()=>{
 assert.equal(canBindStatementAccount("622200001234","5983",false),false);
 assert.equal(canBindStatementAccount("622200001234","5983",true),true);
 assert.equal(canBindStatementAccount("","5983",true),false);
});
