"use client";

import { useEffect, useRef, useState } from "react";
import { FolderOpen, LockKeyhole } from "lucide-react";
import LocalPhotoLibrary from "@/src/components/LocalPhotoLibrary";
import LocalVaultModule from "@/src/components/LocalVaultModule";
import { lockVaultBeforeLeave } from "@/src/lib/vaultAutoLock";
import { desktopVault } from "@/src/desktop/vaultAdapter";

type AlbumMode = "local" | "vault";

export default function PhotoSyncModule() {
  const [mode, setMode] = useState<AlbumMode>("local");
  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => () => {
    if (modeRef.current !== "vault" || typeof window === "undefined") return;
    void lockVaultBeforeLeave(desktopVault.available() ? desktopVault : undefined).catch(() => undefined);
  }, []);

  const switchMode = async (nextMode: AlbumMode) => {
    if (nextMode === mode) return;
    if (mode === "vault") {
      try {
        await lockVaultBeforeLeave(desktopVault.available() ? desktopVault : undefined);
      } catch (cause) {
        console.error("Failed to lock private vault before switching tabs", cause);
        window.alert("私密相册锁定失败，请重试后再切换页签。");
        return;
      }
    }
    setMode(nextMode);
  };

  return <div className="photo-album-shell">
    <div className="photo-album-tabs" role="tablist" aria-label="相册模式">
      <button role="tab" aria-selected={mode === "local"} className={mode === "local" ? "active" : ""} onClick={() => void switchMode("local")}><FolderOpen/>本地图库</button>
      <button role="tab" aria-selected={mode === "vault"} className={mode === "vault" ? "active" : ""} onClick={() => void switchMode("vault")}><LockKeyhole/>私密相册</button>
    </div>
    {mode === "local" ? <LocalPhotoLibrary/> : <LocalVaultModule/>}
  </div>;
}
