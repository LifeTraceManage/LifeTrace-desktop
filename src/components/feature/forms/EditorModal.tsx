import { useState } from "react";
import { X } from "lucide-react";
import { useLifeStore } from "@/src/stores/useLifeStore";
import type {
  Activity,
  ActivityLog,
} from "@/src/types";
import PersistProjectDialog from "@/src/components/persist-project/PersistProjectDialog";
import { dateTimeLocal } from "@/src/utils/format";
import { notify } from "@/src/ui/feedback/toastBus";

export type EditorModalState =
  | null
  | { kind: "activity"; value?: Activity }
  | { kind: "record"; value: Activity };

export default function EditorModal({
  modal,
  close,
}: {
  modal: EditorModalState;
  close: () => void;
}) {
  if (modal?.kind === "record") return <RecordForm activity={modal.value} close={close} />;
  if (modal?.kind === "activity")
    return <PersistProjectDialog activity={modal.value} onClose={close} />;
  return null;
}

function ModalFrame({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="hx-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="hx-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            <span className="hx-kicker">编辑内容</span>
            <h2>{title}</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={close}>
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function RecordForm({
  activity,
  close,
}: {
  activity: Activity;
  close: () => void;
}) {
  const { addLog } = useLifeStore();
  const [value, setValue] = useState(activity.normalTarget ?? 1);
  const [status, setStatus] =
    useState<NonNullable<ActivityLog["status"]>>("completed");
  const [state, setState] =
    useState<NonNullable<ActivityLog["metadata"]>["state"]>("stable");
  const [urgeLevel, setUrgeLevel] = useState(5);
  const [triggers, setTriggers] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const triggerOptions = ["压力", "疲劳", "无聊", "社交场景", "环境诱因"];
  const actionOptions = ["离开现场", "喝水", "短暂散步", "呼吸放松", "联系支持者"];
  const toggle = (
    list: string[],
    item: string,
    set: (value: string[]) => void,
  ) => set(list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (activity.type === "control") {
      await addLog(
        activity.id,
        undefined,
        "completed",
        {
          state,
          urgeLevel: state === "stable" ? undefined : urgeLevel,
          triggers: state === "stable" ? [] : triggers,
          actions: state === "stable" ? [] : actions,
        },
        note,
      );
    } else if (activity.type === "completion") {
      await addLog(activity.id, undefined, status, undefined, note);
    } else {
      await addLog(activity.id, value, "completed", undefined, note);
    }
    notify(`${activity.name}已记录`);
    close();
  };

  return (
    <ModalFrame title={`记录：${activity.name}`} close={close}>
      <form className="hx-form hx-record-form" onSubmit={submit}>
        {activity.type === "control" ? (
          <>
            <label>
              当前状态
              <div className="hx-choice-row">
                {(
                  [
                    ["stable", "保持稳定"],
                    ["urge", "出现冲动"],
                    ["relapse", "发生偏离"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    className={state === id ? "active" : ""}
                    onClick={() => setState(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </label>
            {state !== "stable" ? (
              <>
                <label className="hx-range">
                  <span>
                    冲动强度<b>{urgeLevel}/10</b>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={urgeLevel}
                    onChange={(event) => setUrgeLevel(Number(event.target.value))}
                  />
                </label>
                <fieldset className="hx-choice-group">
                  <legend>可能诱因（可多选）</legend>
                  <div>
                    {triggerOptions.map((item) => (
                      <button
                        type="button"
                        key={item}
                        className={triggers.includes(item) ? "active" : ""}
                        onClick={() => toggle(triggers, item, setTriggers)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="hx-choice-group">
                  <legend>已采取行动（可多选）</legend>
                  <div>
                    {actionOptions.map((item) => (
                      <button
                        type="button"
                        key={item}
                        className={actions.includes(item) ? "active" : ""}
                        onClick={() => toggle(actions, item, setActions)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            ) : null}
          </>
        ) : activity.type === "completion" ? (
          <label>
            完成情况
            <div className="hx-choice-row">
              {(
                [
                  ["completed", "已完成"],
                  ["partial", "部分完成"],
                  ["skipped", "今天跳过"],
                ] as const
              ).map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  className={status === id ? "active" : ""}
                  onClick={() => setStatus(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
        ) : (
          <label>
            本次完成量
            <input
              autoFocus
              required
              type="number"
              min="0"
              step={activity.type === "duration" ? "1" : "0.1"}
              value={value}
              onChange={(event) => setValue(Number(event.target.value))}
            />
            <small>
              单位：{activity.unit}，目标：{activity.normalTarget ?? 1} {activity.unit}
            </small>
          </label>
        )}
        <label>
          备注（可选）
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="记录当时的情况或感受"
          />
        </label>
        <footer>
          <button type="button" className="hx-btn secondary" onClick={close}>
            取消
          </button>
          <button type="submit" className="hx-btn primary">
            保存记录
          </button>
        </footer>
      </form>
    </ModalFrame>
  );
}
