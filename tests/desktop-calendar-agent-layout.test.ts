import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("sidebar calendar preserves life records without duplicate planned task tab", () => {
  const route = read("src/components/DesktopNativeRouteContent.tsx");
  const calendar = read("src/components/DesktopCalendarWorkspace.tsx");
  const oldView = read("src/components/feature/life/CalendarView.tsx");
  assert.match(route, /<DesktopCalendarWorkspace onNavigate=\{navigate\}/);
  assert.doesNotMatch(calendar, /ExecutionModule|日程与未来任务/);
  assert.match(calendar, /<CalendarView/);
  const execution = read("src/components/feature/execution/ExecutionModule.tsx");
  assert.match(execution, /CalendarWorkspace/);
  assert.match(execution, /"planner"/);
  for (const label of ["项目记录", "每日复盘", "生活日志"]) {
    assert.ok(oldView.includes(label), `Life calendar must preserve ${label}`);
  }
});

test("AI chat owns independent scroll and keeps the composer outside the scroll pane", () => {
  const shell = read("src/components/DesktopWorkbenchShell.tsx");
  const agent = read("src/components/CloudAgentModule.tsx");
  const agentCss = read("app/cloud-agent.css");
  const shellCss = read("app/desktop-cloud-workspace.css");
  assert.match(shell, /agent-route/);
  assert.match(shellCss, /\.lt-desk-content\.agent-route[\s\S]*?overflow: hidden/);
  assert.match(agent, /ref=\{messagesRef\} aria-live="polite"/);
  assert.match(agent, /container\.scrollTo\(/);
  assert.doesNotMatch(agent, /scrollIntoView/);
  assert.ok(agent.indexOf('className="lt-cloud-agent-composer"') > agent.indexOf('className="lt-cloud-agent-messages"'));
  assert.match(agentCss, /\.lt-cloud-agent-messages\{[^}]*overflow-y:auto/);
  assert.match(agentCss, /\.lt-cloud-agent-main\{[^}]*min-height:0/);
});

test("AI session history is a top-aligned vertical list", () => {
  const css = read("app/cloud-agent.css");
  assert.match(css, /\.lt-cloud-agent-history-list\{[^}]*display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start/);
  assert.match(css, /\.lt-cloud-agent-history-list article\{[^}]*flex:0 0 auto/);
  assert.match(css, /\.lt-cloud-agent-message\{[^}]*flex:0 0 auto/);
});
