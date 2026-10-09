import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSources, bankChannel, cardTail, currencyCents } from "../src/utils/statementReconciliation";
import { normalizeArchivedRows, reconcileArchivedRows } from "../src/utils/archivedStatementReconciliation";
const t = (id: string, source: "icbc" | "wechat" | "alipay", minute: number, tail?: string) => ({
  id, source, amountCents: 2500, direction: "expense" as const, epochMs: Date.UTC(2026,9,9,10,minute),
  cardLast4: tail, channel: source === "icbc" ? "wechat" as const : undefined,
});
test("matches only uniquely evidenced bank-backed payment", () => {
  const out = reconcileSources([t("bank","icbc",1,"1234"),t("wx","wechat",2,"1234")]);
  assert.equal(out.matches.length, 1);
  assert.deepEqual(out.matches[0],{bankId:"bank",paymentId:"wx",reason:"unique-card-time-channel"});
});
test("same amount, different card must never deduplicate", () => {
  const out = reconcileSources([t("bank","icbc",1,"1234"),t("wx","wechat",2,"5678")]);
  assert.equal(out.matches.length,0);
});
test("two equal candidate payments remain ambiguous, no auto merge", () => {
  const out = reconcileSources([t("bank","icbc",1,"1234"),t("wx1","wechat",2,"1234"),t("wx2","wechat",3,"1234")]);
  assert.equal(out.matches.length,0);
  assert.equal(out.reviewIds.length,3);
});
test("a single payment cannot match two bank rows", () => {
  const out = reconcileSources([t("bank1","icbc",1,"1234"),t("bank2","icbc",2,"1234"),t("wx","wechat",2,"1234")]);
  assert.equal(out.matches.length,0);
});
test("different channels, time windows and missing tails are conservative", () => {
  assert.equal(reconcileSources([{...t("bank","icbc",0,"1234"),channel:"alipay"},t("wx","wechat",1,"1234")]).matches.length,0);
  assert.equal(reconcileSources([t("bank","icbc",0,"1234"),t("wx","wechat",45,"1234")]).matches.length,0);
  const missing = reconcileSources([t("bank","icbc",0),t("wx","wechat",2)]);
  assert.equal(missing.matches.length,0);
  assert.equal(missing.reviewIds.length,2);
});
test("payment metadata normalization", () => {
  assert.equal(cardTail("工商银行储蓄卡(1234)"),"1234");
  assert.equal(cardTail("工商银行尾号 1234"),"1234");
  assert.equal(currencyCents("¥12.30"),1230);
  assert.equal(bankChannel("财付通支付科技有限公司","消费"),"wechat");
  assert.equal(bankChannel("支付宝","二维码支付"),"alipay");
});

test("archived WeChat bank-card payment joins corresponding ICBC row", () => {
  const rows = [
    {batchId:"bankbatch",ordinal:1,source:"icbc" as const,status:"parsed",
      payload:{date:"2026-10-09",time:"10:01:00",account:"622200001234",amount:"-25.00",
        counterparty:"财付通支付科技",summary:"二维码消费"}},
    {batchId:"wechatbatch",ordinal:1,source:"wechat" as const,status:"review",
      payload:{headers:["交易时间","收/支","金额(元)","支付方式","交易单号"],
        cells:["2026-10-09 10:02:00","支出","¥25.00","工商银行储蓄卡(1234)","W123"]}},
  ];
  const normalized = normalizeArchivedRows(rows);
  assert.equal(normalized.length,2);
  assert.deepEqual(reconcileArchivedRows(rows).matches,
    [{bankId:"bankbatch:1",paymentId:"wechatbatch:1",reason:"unique-card-time-channel"}]);
});
test("wallet payment does not consume an ICBC debit", () => {
  const rows = [
    {batchId:"bankbatch",ordinal:1,source:"icbc" as const,status:"parsed",
      payload:{date:"2026-10-09",time:"10:01:00",account:"622200001234",amount:"-25.00",
        counterparty:"财付通支付科技",summary:"消费"}},
    {batchId:"wechatbatch",ordinal:1,source:"wechat" as const,status:"review",
      payload:{headers:["交易时间","收/支","金额(元)","支付方式"],
        cells:["2026-10-09 10:02:00","支出","25.00","微信零钱"]}},
  ];
  assert.equal(reconcileArchivedRows(rows).matches.length,0);
});

test("bank-funded payment without tail stays review, never blindly deduplicated", () => {
  const rows = [
    {batchId:"bankbatch",ordinal:1,source:"icbc" as const,status:"parsed",
      payload:{date:"2026-10-09",time:"10:01:00",account:"622200001234",amount:"-25.00",
        counterparty:"财付通",summary:"消费"}},
    {batchId:"wechatbatch",ordinal:1,source:"wechat" as const,status:"review",
      payload:{headers:["交易时间","收/支","金额(元)","支付方式"],
        cells:["2026-10-09 10:02:00","支出","25.00","工商银行储蓄卡"]}},
  ];
  const result = reconcileArchivedRows(rows);
  assert.equal(result.matches.length,0);
  assert.equal(result.reviewIds.length,2);
});
test("no bank channel but matching card is still review only", () => {
  const bank = {...t("bank","icbc",1,"1234"),channel:undefined};
  const result = reconcileSources([bank,t("wx","wechat",2,"1234")]);
  assert.equal(result.matches.length,0);
  assert.equal(result.reviewIds.length,2);
});
