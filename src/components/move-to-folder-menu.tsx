import type { ReactNode } from "react";
import { Folder } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export interface MoveTarget {
  name: string;
  label: string;
}

/// 批量/阅读器共用的「移动到文件夹」下拉：目标跟随账号（服务器文件夹或本机归档目录）。
export function MoveToFolderMenu({
  accountName,
  server,
  targets,
  reason,
  onSelect,
  children,
}: {
  accountName?: string;
  server: boolean;
  targets: MoveTarget[];
  reason?: string;
  onSelect: (target: MoveTarget) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {reason ? (
          <DropdownMenuItem disabled>{reason}</DropdownMenuItem>
        ) : targets.length ? (
          <>
            <DropdownMenuLabel>
              {server
                ? `服务器文件夹 · ${accountName}`
                : `本机归档目录 · ${accountName}`}
            </DropdownMenuLabel>
            {targets.map((target) => (
              <DropdownMenuItem
                key={target.name}
                onSelect={() => onSelect(target)}
              >
                <Folder />
                {target.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : (
          <DropdownMenuItem disabled>没有可用的目标文件夹</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
