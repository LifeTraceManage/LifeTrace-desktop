import { ArrowLeft, HardDrive } from "lucide-react";

export default function DesktopLocalToolsCenter({ onClose }: { onClose: () => void }) {
  return <section className="lt-local-tools-center">
    <header className="lt-local-tools-head">
      <button type="button" className="lt-local-tools-back" onClick={onClose}>
        <ArrowLeft />返回工作台
      </button>
      <h1>本机工具</h1>
    </header>
    <div className="lt-local-tools-loading">
      <HardDrive />
      <span>本机工具入口已整理，其他功能仍可从左侧导航访问。</span>
    </div>
  </section>;
}
