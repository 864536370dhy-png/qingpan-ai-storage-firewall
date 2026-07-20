import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "轻盘 · AI 空间管家",
  description: "告诉 AI 想释放多少空间，它会通过清理、压缩和迁移生成一套安全方案。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
