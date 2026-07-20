import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "轻盘 · AI 空间防火墙",
  description: "看懂空间为什么增长，用 AI 调查来源、设置应用预算，并通过安全区可恢复地释放空间。",
  openGraph: {
    title: "轻盘 · AI 空间防火墙",
    description: "不只清理垃圾，更能解释空间变化、限制应用占用，并安全恢复。",
    images: ["/qingpan-social.png"],
  },
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
