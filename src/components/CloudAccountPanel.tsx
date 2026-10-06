import { Cloud, ShieldCheck, CircleHelp, HardDrive } from "lucide-react";
import CloudSyncSettingsPanel from "@/src/components/CloudSyncSettingsPanel";
import StorageLocationPanel from "@/src/components/StorageLocationPanel";
import AccountSecurityPanel from "@/src/components/account/AccountSecurityPanel";

const sections = [
  ["settings-sync", "数据与同步", Cloud],
  ["settings-storage", "存储", HardDrive],
  ["settings-security", "账户与安全", ShieldCheck],
  ["settings-about", "关于", CircleHelp],
] as const;

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function CloudAccountPanel() {
  return <>
    <aside className="hx-settings-nav" aria-label="设置分类">
      <h2>设置</h2>
      <nav>{sections.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => jumpTo(id)}><Icon /><span>{label}</span></button>)}</nav>
    </aside>
    <CloudSyncSettingsPanel />
    <StorageLocationPanel />
    <AccountSecurityPanel />
  </>;
}
