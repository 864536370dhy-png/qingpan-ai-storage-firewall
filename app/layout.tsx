import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "轻盘 · AI 驱动的智能空间管理产品",
  description: "用 AI 看懂空间变化、定位应用占用、生成安全处理建议，让电脑空间管理更清晰。",
  openGraph: {
    title: "轻盘 · AI 驱动的智能空间管理产品",
    description: "不只清理文件，更能解释空间变化、定位应用占用并生成安全处理建议。",
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
