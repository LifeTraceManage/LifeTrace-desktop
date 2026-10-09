import { useEffect, useRef, useState } from "react";
import { archiveBillRows, listArchivedStatementBatches } from "@/src/services/statementArchive";
import type { StoredStatementBatch } from "@/src/services/statementArchive";
import { FileUp } from "lucide-react";
import { useLifeStore } from "@/src/stores/useLifeStore";
import type { Transaction } from "@/src/types";
import { PanelHead } from "@/src/components/common";
import { notify } from "@/src/ui/feedback/toastBus";
import { pad, transactionAmountText } from "@/src/utils/format";
import { parseIcbcPdf, toCents } from "@/src/utils/icbcStatement";

type ImportRow = {
  type: Transaction["type"];
  amount: number;
  category: string;
  account: string;
  note?: string;
  occurredAt?: string;
  accountId?: string;
  toAccount?: string;
  toAccountId?: string;
  counterparty?: string;
  item?: string;
  sourceId?: string;
};


export default function ImportBills() {
  const { accounts, transactions, addTransaction, saveAccount } = useLifeStore();
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [message, setMessage] = useState("");
  const [draggingBill, setDraggingBill] = useState(false);
  const [billSource, setBillSource] = useState<"wechat" | "alipay" | "icbc" | "generic">(
    "generic",
  );
  const [summary, setSummary] = useState({
    source: 0,
    neutral: 0,
    transfers: 0,
    unmatched: 0,
    duplicates: 0,
    invalid: 0,
  });
  const [importing, setImporting] = useState(false);
  const [bankAccountId, setBankAccountId] = useState("");
  const [newBankName, setNewBankName] = useState("工商银行储蓄卡");
  const [newBankLast4, setNewBankLast4] = useState("");
  const [newBankBalance, setNewBankBalance] = useState("");
  const [savingBank, setSavingBank] = useState(false);
  const bankAccounts = accounts.filter(account => account.type === "bank");
  const isPendingTransfer = (row: ImportRow) =>
    row.type === "transfer" || row.category === "资金流转（待确认）";
  const resolvedAccount = bankAccounts.find(account => account.id === bankAccountId);
  const effectiveBankRows = rows.map(row =>
    billSource === "icbc" && !row.accountId && resolvedAccount &&
      (!resolvedAccount.last4 || row.sourceId?.split("/")[3]?.endsWith(resolvedAccount.last4))
      ? { ...row, account: resolvedAccount.name, accountId: resolvedAccount.id }
      : row,
  );
  const readyRows = effectiveBankRows.filter(row =>
    billSource === "icbc"
      ? Boolean(row.accountId) && !isPendingTransfer(row)
      : true,
  );
  const pendingRows = billSource === "icbc"
    ? effectiveBankRows.filter(row => !row.accountId || isPendingTransfer(row))
    : [];
  const [archiveBatches, setArchiveBatches] = useState<StoredStatementBatch[]>([]);
  const refreshArchive = () => { void listArchivedStatementBatches().then(setArchiveBatches).catch(() => undefined); };
  useEffect(() => { refreshArchive(); }, []);

  const parseLine = (line: string) => {
    const result: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = !quoted;
      } else if (c === "," && !quoted) {
        result.push(cell);
        cell = "";
      } else {
        cell += c;
      }
    }
    result.push(cell);
    return result;
  };

  const decodeCsv = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder("utf-8").decode(bytes.subarray(3));
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder("gb18030").decode(bytes);
    }
  };

  const cellText = (value: unknown) =>
    value instanceof Date
      ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
      : String(value ?? "").trim();

  const inferCategory = (
    type: "income" | "expense",
    transactionType: string,
    counterparty: string,
    item: string,
  ) => {
    const text = `${transactionType} ${counterparty} ${item}`;
    if (type === "income") return /退款|退还|退回/.test(text) ? "退款" : "其他收入";
    if (/餐饮|餐厅|饭|面|粉|水煮鱼|豆制品|咖啡|茶|奶茶|麦当劳|肯德基|食堂|亚惠/.test(text))
      return "餐饮";
    if (/地铁|公交|打车|滴滴|铁路|航空|加油|停车|充电/.test(text)) return "交通";
    if (/拼多多|淘宝|京东|商户消费|超市|便利店|眼镜|百货/.test(text)) return "购物";
    if (/医院|药房|诊所|医疗|体检/.test(text)) return "医疗健康";
    if (/话费|电费|水费|燃气|宽带|物业/.test(text)) return "生活缴费";
    if (/红包|群收款|转账|二维码付款|扫二维码/.test(text)) return "转账与人情";
    return "日常消费";
  };

  const read = async (file: File) => {
    let archivedOriginal = false;
    try {
      setRows([]);
      setMessage("正在解析账单…");

      if (/\.pdf$/i.test(file.name)) {
        setBillSource("icbc");
        setBankAccountId("");
        let statement;
        try {
          statement = await parseIcbcPdf(file);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await archiveBillRows(file, "icbc", [{
            ordinal: 1, payload: {error: reason, filename: file.name}, status: "invalid",
          }], false, {parseError: reason, transactions: 0});
          archivedOriginal = true;
          refreshArchive();
          setMessage("PDF 无法正确解析：已保存原始文件供重新识别，未生成任何财务交易。原因：" + reason);
          return;
        }
        if (statement.transactions.length === 0) throw new Error("未识别到银行交易，无法归档");
        const archived = await archiveBillRows(file, "icbc", statement.transactions.map((tx, i) => ({
          ordinal: i + 1, payload: tx, status: statement.valid ? "parsed" as const : "review" as const,
        })), statement.valid, {
          transactions: statement.transactions.length,
          pages: statement.pages,
          balanceErrors: statement.balanceErrors,
        });
        archivedOriginal = true;
        if (!statement.valid) {
          refreshArchive();
          setMessage("原始银行流水已存档 " + archived.persisted + " 行，但未通过校验，禁止生成收支交易：" + statement.errors.join("；"));
          return;
        }
        refreshArchive();
        const banks = accounts.filter(account => account.type === "bank");
        const parsed: ImportRow[] = [];
        let unmatched = 0, duplicates = 0, transfers = 0;
        for (const tx of statement.transactions) {
          const timestamp = Date.parse(tx.date + "T" + tx.time + "+08:00");
          const signed = toCents(tx.amount);
          const cents = Number(signed < 0n ? -signed : signed);
          if (!Number.isFinite(timestamp) || !Number.isSafeInteger(cents) || cents <= 0)
            throw new Error("银行交易时间或金额不合法");
          const account = banks.find(a => a.last4 && tx.account.endsWith(a.last4))
;
          if (!account) unmatched++;
          const type = signed > 0n ? "income" : "expense";
          const key = ["工商银行流水", tx.date, tx.time, tx.account, tx.amount, tx.balance].join("/");
          const existing = transactions.some(item => item.note?.includes(key));
          const intermediary = /财付通|支付宝/.test(tx.counterparty);
          const matched = intermediary && transactions.some(item =>
            item.type === type && Math.round(item.amount * 100) === cents &&
            Math.abs(Date.parse(item.occurredAt) - timestamp) <= 5 * 60 * 1000 &&
            /微信|支付宝/.test((item.note ?? "") + " " + item.account));
          if (existing || matched) { duplicates++; continue; }
          const internal = /基金购买|理财|余额宝|微信零钱提|跨行汇款|他行汇入/.test(tx.summary);
          if (internal) transfers++;
          parsed.push({
            type, amount: cents / 100, account: account?.name ?? "未匹配银行账户",
            accountId: account?.id, occurredAt: new Date(timestamp).toISOString(),
            category: internal ? "资金流转（待确认）" : type === "income" ? "其他收入" : "日常消费",
            counterparty: tx.counterparty || "未识别对方", item: tx.summary,
            note: key + " · 交易渠道：" + tx.channel + " · 交易后余额：" + tx.balance +
              (internal ? " · 待人工确认内部转账" : ""),
            sourceId: key,
          });
        }
        setRows(parsed);
        setSummary({source: statement.transactions.length, neutral: 0, transfers, unmatched, duplicates, invalid: 0});
        setMessage("原始银行流水已保存 " + archived.persisted + " 笔（" + (archived.existing ? "重复文件，无新增" : "新批次") + "）；PDF 通过 " + statement.pages.length + " 页校验，已解析 " +
          statement.transactions.length + " 笔；跳过 " + duplicates + " 笔已存在或疑似重复的记录。" +
          (unmatched || transfers ? "可在下方选择银行账户，安全的普通收支可单独入账，资金流转保留待复核。" : ""));
        return;
      }
      let matrix: unknown[][];
      if (file.name.toLowerCase().endsWith(".xlsx")) {
        const { readSheet } = await import("read-excel-file/browser");
        matrix = await readSheet(file);
      } else {
        const lines = (await decodeCsv(file))
          .replace(/^\uFEFF/, "")
          .split(/\r?\n/)
          .filter(Boolean);
        matrix = lines.map(parseLine);
      }
      const headerRow = matrix.findIndex((row) => {
        const text = row.map(cellText);
        return (
          text.some(
            (item) => item.includes("交易时间") || item.toLowerCase().includes("date"),
          ) &&
          text.some(
            (item) => item.includes("金额") || item.toLowerCase().includes("amount"),
          )
        );
      });
      if (headerRow < 0)
        throw new Error(
          "没有找到支付账单明细表头，请确认文件是微信或支付宝导出的 CSV / Excel 账单",
        );
      const headers = matrix[headerRow].map((value) =>
        cellText(value).replace(/\s/g, ""),
      );
      const source = headers.some(
        (header) => header.includes("收/付款方式") || header.includes("交易订单号"),
      )
        ? ("alipay" as const)
        : headers.some((header) => header.includes("微信"))
          ? ("wechat" as const)
          : ("generic" as const);
      setBillSource(source);
      const originalRows = matrix.slice(headerRow + 1).filter(row => row.some(value => cellText(value) !== ""));
      const archived = await archiveBillRows(file, source, originalRows.map((row, ordinal) => ({
        ordinal: ordinal + 1,
        payload: {headers, cells: row.map(cellText)},
        status: "review" as const,
      })), false, {headerRow: headerRow + 1, rows: originalRows.length});
      archivedOriginal = true;
      refreshArchive();
      const index = (...names: string[]) =>
        headers.findIndex((header) =>
          names.some((name) => header.toLowerCase().includes(name.toLowerCase())),
        );
      const dateIndex = index("交易时间", "时间", "日期", "date");
      const transactionTypeIndex = index("交易类型", "交易分类");
      const counterpartyIndex = index("交易对方", "交易对象", "商户", "counterparty");
      const itemIndex = index("商品", "说明", "item");
      const directionIndex = index("收/支", "收支", "direction");
      const amountIndex = index("金额", "amount");
      const accountIndex = index(
        "收/付款方式",
        "付款方式",
        "支付方式",
        "账户",
        "account",
      );
      const statusIndex = index("当前状态", "状态");
      const sourceIdIndex = index("交易订单号", "交易单号");
      const categoryIndex = index("分类", "category");
      if (dateIndex < 0 || amountIndex < 0 || directionIndex < 0)
        throw new Error("账单缺少交易时间、收/支或金额列");
      const existingIds = new Set(
        transactions.flatMap((item) => {
          const match = item.note?.match(/(?:微信|支付宝)交易单号：([^\s·]+)/);
          return match ? [match[1]] : [];
        }),
      );
      let neutral = 0;
      let transfers = 0;
      let unmatched = 0;
      let duplicates = 0;
      let invalid = 0;
      const parsed: ImportRow[] = [];
      const matchAccount = (rawAccount: string) => {
        const direct = accounts.find(
          (candidate) =>
            candidate.name === rawAccount ||
            rawAccount.includes(candidate.name) ||
            (candidate.last4 && rawAccount.includes(candidate.last4)),
        );
        if (direct) return direct;
        if (/银行|信用卡/.test(rawAccount)) {
          const namedBank = accounts.find(
            (candidate) =>
              candidate.type === "bank" &&
              candidate.name.replace(/^中国/, "") !== "银行" &&
              rawAccount.includes(candidate.name.replace(/^中国/, "")),
          );
          if (namedBank) return namedBank;
          const banks = accounts.filter((candidate) => candidate.type === "bank");
          return banks.length === 1 ? banks[0] : undefined;
        }
        if (/零钱|微信/.test(rawAccount))
          return accounts.find((candidate) => candidate.type === "wechat");
        if (/支付宝|余额宝|花呗|账户余额/.test(rawAccount))
          return accounts.find((candidate) => candidate.type === "alipay");
        return undefined;
      };
      for (const rawRow of matrix.slice(headerRow + 1)) {
        const cells = rawRow.map(cellText);
        if (cells.every((cell) => !cell)) continue;
        const direction = cells[directionIndex] ?? "";
        const transactionType = cells[transactionTypeIndex] ?? "";
        const sourceName =
          source === "alipay" ? "支付宝" : source === "wechat" ? "微信支付" : "支付账单";
        const counterparty = cells[counterpartyIndex] || sourceName;
        const item = (cells[itemIndex] ?? "").replace(/^\/$/, "");
        const neutralDirection = /中性|\/|不计收支/.test(direction);
        const isYield =
          neutralDirection && /收益发放|收益结转/.test(`${transactionType} ${counterparty} ${item}`);
        const isTransfer =
          neutralDirection &&
          /余额宝.*(?:转入|收款)|(?:转入|收款).*余额宝/.test(
            `${transactionType} ${counterparty} ${item}`,
          );
        if (neutralDirection && !isYield && !isTransfer) {
          neutral++;
          continue;
        }
        const type = isYield
          ? ("income" as const)
          : isTransfer
            ? ("transfer" as const)
            : /收入|income|入账/i.test(direction)
              ? ("income" as const)
              : /支出|expense/i.test(direction)
                ? ("expense" as const)
                : null;
        const amount = Math.abs(
          Number((cells[amountIndex] ?? "").replace(/[¥￥,\s]/g, "")),
        );
        const dateText = cells[dateIndex] ?? "";
        const parsedDate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateText)
          ? new Date(`${dateText.replace(" ", "T")}+08:00`)
          : new Date(dateText);
        if (
          !type ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          !dateText ||
          Number.isNaN(parsedDate.getTime())
        ) {
          invalid++;
          continue;
        }
        const occurredAt = parsedDate.toISOString();
        const sourceId = (cells[sourceIdIndex] ?? "").trim();
        if (sourceId && existingIds.has(sourceId)) {
          duplicates++;
          continue;
        }
        const rawAccount = (cells[accountIndex] ?? "").replace(/^\/$/, "").trim();
        const account = matchAccount(rawAccount);
        const toAccount = isTransfer ? matchAccount("余额宝") : undefined;
        const status = (cells[statusIndex] ?? "").replace(/^\/$/, "");
        if (isTransfer) transfers++;
        const row: ImportRow = {
          type,
          amount,
          category: isTransfer
            ? "账户转账"
            : cells[categoryIndex] ||
              inferCategory(
                type === "income" ? "income" : "expense",
                transactionType,
                counterparty,
                item,
              ),
          account: account?.name || rawAccount || sourceName,
          accountId: account?.id,
          toAccount: isTransfer ? toAccount?.name || "余额宝" : undefined,
          toAccountId: toAccount?.id,
          counterparty,
          item,
          occurredAt,
          note: [
            transactionType,
            status,
            sourceId
              ? `${source === "alipay" ? "支付宝" : "微信"}交易单号：${sourceId}`
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
          sourceId,
        };
        if (!row.accountId || (row.type === "transfer" && !row.toAccountId))
          unmatched++;
        parsed.push(row);
        if (sourceId) existingIds.add(sourceId);
      }
      setRows(parsed);
      setSummary({
        source: matrix.length - headerRow - 1,
        neutral,
        transfers,
        unmatched,
        duplicates,
        invalid,
      });
      setMessage(
        `已保存 ${archived.persisted} 行原始账单（${archived.existing ? "已存在的文件" : "新批次"}）；已识别 ${parsed.length} 笔可导入记录${transfers ? `，其中 ${transfers} 笔账户转账` : ""}${unmatched ? `，${unmatched} 笔尚未匹配账户` : ""}${duplicates ? `，自动跳过 ${duplicates} 笔重复账单` : ""}`,
      );
    } catch (error) {
      setRows([]);
      const reason = error instanceof Error ? error.message : "文件解析失败";
      if (!archivedOriginal) {
        try {
          const source = /\.pdf$/i.test(file.name) ? "icbc" : "generic";
          await archiveBillRows(file, source, [{
            ordinal: 1, payload: {parseError: reason, filename: file.name}, status: "invalid",
          }], false, {parseError: reason, transactions: 0});
          refreshArchive();
          setMessage("已归档待复核原始文件，未生成财务交易。原因：" + reason);
        } catch (archiveError) {
          setMessage("解析及原始文件归档均失败：" +
            (archiveError instanceof Error ? archiveError.message : String(archiveError)) +
            "；解析原因：" + reason);
        }
      } else {
        setMessage("原始账单已保留，但交易解析失败：" + reason);
      }
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const acceptBillFile = (file?: File) => {
    if (!file) return;
    if (!/\.(csv|xlsx|pdf)$/i.test(file.name)) {
      setRows([]);
      setMessage("仅支持 CSV、Excel 或工商银行 PDF 账单");
      return;
    }
    void read(file);
  };

  const createBankAccount = async () => {
    const name = newBankName.trim();
    const last4 = newBankLast4.trim();
    if (!name || !/^\d{4}$/.test(last4)) {
      setMessage("请填写银行账户名称及卡号后四位（4 位数字）。");
      return;
    }
    if (accounts.some(account => account.type === "bank" && account.last4 === last4)) {
      setMessage("已存在相同卡号后四位的银行账户，请直接从列表中选择。");
      return;
    }
    const balance = newBankBalance.trim() === "" ? 0 : Number(newBankBalance);
    if (!Number.isFinite(balance) || !Number.isSafeInteger(Math.round(balance * 100))) {
      setMessage("账户当前余额格式不正确。");
      return;
    }
    setSavingBank(true);
    try {
      await saveAccount({ name, type: "bank", last4, balance,
        balanceAt: new Date().toISOString(), color: "#247b65", icon: "landmark" });
      const saved = useLifeStore.getState().accounts.find(account =>
        account.type === "bank" && account.name === name && account.last4 === last4);
      if (saved) setBankAccountId(saved.id);
      setMessage("银行账户已创建。当前余额作为今天的余额基准，历史流水不会重复调整该余额。请核对可入账笔数。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建银行账户失败");
    } finally {
      setSavingBank(false);
    }
  };

  const commit = async () => {
    if (importing || readyRows.length === 0) {
      setMessage("没有可安全入账的记录。请先绑定银行账户，资金流转仍需单独核对。");
      return;
    }
    setImporting(true);
    let committed = 0;
    const committedRows = new Set<ImportRow>();
    try {
      for (const row of readyRows) {
        const already = row.sourceId && useLifeStore.getState().transactions.some(
          item => item.note?.includes(row.sourceId!),
        );
        if (!already) {
          const transaction: Parameters<typeof addTransaction>[0] = {
            type: row.type, amount: row.amount, category: row.category,
            account: row.account, note: row.note, occurredAt: row.occurredAt,
            accountId: row.accountId, toAccount: row.toAccount,
            toAccountId: row.toAccountId, counterparty: row.counterparty, item: row.item,
          };
          await addTransaction(transaction);
          committed++;
        }
        committedRows.add(row);
      }
      const sourceName = billSource === "alipay" ? "支付宝" :
        billSource === "wechat" ? "微信" : billSource === "icbc" ? "工商银行" : "支付";
      const remaining = effectiveBankRows.filter(row => !committedRows.has(row));
      setRows(remaining);
      setMessage(`已安全入账 ${committed} 笔${sourceName}流水；${remaining.length} 笔保留待复核。全部原始流水继续保存在账单档案中。`);
      notify(`${sourceName}已入账 ${committed} 笔`);
    } catch (error) {
      // Already committed rows stay in SQLite. Never claim a failed batch was atomic.
      setRows(effectiveBankRows.filter(row => !committedRows.has(row)));
      setMessage(`已入账 ${committed} 笔，其余未入账。请核对后重试：` +
        (error instanceof Error ? error.message : "账单导入失败"));
    } finally {
      setImporting(false);
    }
  };
  return (
    <div className="hx-view">
      <div className="hx-import-grid">
        <article className="hx-panel">
          <PanelHead kicker="工商银行 / 微信 / 支付宝" title="导入交易流水" />
          <div className="hx-panel-body">
            <div
              className={`hx-drop${draggingBill ? " is-dragging" : ""}`}
              role="button"
              tabIndex={0}
              aria-label="拖放或选择工商银行、微信、支付宝账单文件"
              onClick={() => input.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  input.current?.click();
                }
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                dragDepth.current += 1;
                setDraggingBill(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDraggingBill(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                dragDepth.current = 0;
                setDraggingBill(false);
                acceptBillFile(event.dataTransfer.files?.[0]);
              }}
            >
              <FileUp />
              <h3>{draggingBill ? "松开即可解析账单" : "拖动账单文件到这里"}</h3>
              <p>支持工商银行电子 PDF、微信 Excel / CSV，以及支付宝 GBK 或 UTF-8 CSV。</p>
              <input
                ref={input}
                type="file"
                hidden
                accept=".pdf,application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
                onChange={(event) => acceptBillFile(event.target.files?.[0])}
              />
              <button
                type="button"
                className="hx-btn primary"
                onClick={(event) => {
                  event.stopPropagation();
                  input.current?.click();
                }}
              >
                选择账单文件
              </button>
            </div>
            {message ? (
              <p className="hx-inline-message" role="status" aria-live="polite">
                {message}
              </p>
            ) : null}
            {billSource === "icbc" && rows.length > 0 ? (
              <div className="hx-import-account-setup">
                <h3>工商银行账户绑定</h3>
                <p>先选择与 PDF 卡号后四位一致的账户。未匹配账户、内部资金划转会保留在原始账单中，只有已绑定的普通收支可以入账。</p>
                <label htmlFor="bank-import-account">未匹配流水归属账户</label>
                <select id="bank-import-account" value={bankAccountId}
                  onChange={event => setBankAccountId(event.target.value)}>
                  <option value="">请选择银行账户</option>
                  {bankAccounts.map(account => (
                    <option key={account.id} value={account.id}>
                      {account.name}{account.last4 ? ` · 尾号 ${account.last4}` : ""}
                    </option>
                  ))}
                </select>
                <details>
                  <summary>新增工商银行账户</summary>
                  <label htmlFor="bank-import-name">账户名称</label>
                  <input id="bank-import-name" value={newBankName}
                    onChange={event => setNewBankName(event.target.value)} />
                  <label htmlFor="bank-import-last4">银行卡尾号（4 位）</label>
                  <input id="bank-import-last4" inputMode="numeric" maxLength={4}
                    placeholder="例如 1234" value={newBankLast4}
                    onChange={event => setNewBankLast4(event.target.value)} />
                  <label htmlFor="bank-import-balance">当前余额（可留空，默认 0）</label>
                  <input id="bank-import-balance" inputMode="decimal"
                    placeholder="今天账户的实际余额" value={newBankBalance}
                    onChange={event => setNewBankBalance(event.target.value)} />
                  <button type="button" className="hx-btn" disabled={savingBank}
                    onClick={() => void createBankAccount()}>
                    {savingBank ? "正在保存…" : "创建并绑定账户"}
                  </button>
                </details>
                <p role="status">可安全入账 {readyRows.length} 笔；待复核 {pendingRows.length} 笔（其中资金流转 
                  {pendingRows.filter(isPendingTransfer).length} 笔）。银行卡尾号不符的记录不会被强制归入所选账户。</p>
              </div>
            ) : null}
            {rows.length > 0 ? (
              <div className="hx-import-preview">
                <div>
                  {effectiveBankRows.slice(0, 12).map((row, index) => (
                    <span key={`${row.sourceId ?? index}`}>
                      <b>{row.counterparty}</b>
                      <small>
                        {row.category} ·{" "}
                        {row.type === "transfer"
                          ? `${row.account} → ${row.toAccount ?? "未匹配账户"}`
                          : row.account}{" "}
                        · {new Date(row.occurredAt ?? "").toLocaleDateString("zh-CN")}
                        {!row.accountId ||
                        (row.type === "transfer" && !row.toAccountId)
                          ? " · 未匹配账户"
                          : ""}
                      </small>
                      <strong>{transactionAmountText(row)}</strong>
                    </span>
                  ))}
                </div>
                {rows.length > 12 ? (
                  <small>另有 {rows.length - 12} 笔记录，可安全入账部分会在确认后导入</small>
                ) : null}
                <button
                  type="button"
                  className="hx-btn primary"
                  disabled={importing || readyRows.length === 0}
                  onClick={commit}
                >
                  {importing ? "正在导入…" : `确认导入 ${readyRows.length} 笔安全收支`}
                </button>
              </div>
            ) : null}
          </div>
        </article>
        <aside className="hx-panel">
          <PanelHead kicker="识别结果" title="支付账单规则" />
          <div className="hx-panel-body hx-rules">
            <p>
              <b>1</b> 自动识别 UTF-8 / GBK 编码，并跳过文件顶部说明。
            </p>
            <p>
              <b>2</b> 余额宝收益按收入导入，账户间转入按转账保存，不虚增收支。
            </p>
            <p>
              <b>3</b> 分别使用微信、支付宝交易单号去重，避免重复入账。
            </p>
            <p>
              <b>4</b> 只有匹配到账户且晚于余额基准时间的流水，才会影响余额。
            </p>
            {summary.source > 0 ? (
              <div className="hx-import-stats">
                <span>
                  明细行 <b>{summary.source}</b>
                </span>
                <span>
                  账户转账 <b>{summary.transfers}</b>
                </span>
                <span>
                  未匹配账户 <b>{summary.unmatched}</b>
                </span>
                <span>
                  其他中性交易 <b>{summary.neutral}</b>
                </span>
                <span>
                  重复账单 <b>{summary.duplicates}</b>
                </span>
                <span>
                  无效记录 <b>{summary.invalid}</b>
                </span>
              </div>
            ) : null}
            <hr />
            <strong>已归档的原始账单</strong>
            {archiveBatches.slice(0, 10).map(batch => (
              <p key={batch.id}>
                <b>{batch.filename}</b>
                <small> · {batch.source} · 已存 {batch.storedRows}/{batch.expectedRows} 行
                  {batch.verified ? " · 已核验" : " · 待复核"}
                </small>
              </p>
            ))}
            <small>这里是独立的原始流水档案，不代表已经计入财务收支。</small>
            <hr />
            <small>
              当前已有 {transactions.length} 笔账单，{accounts.length} 个账户。
            </small>
          </div>
        </aside>
      </div>
    </div>
  );
}
