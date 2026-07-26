import type { Metadata } from "next";
import SchnellEnterClient from "@/components/schnellbestellung/SchnellEnterClient";

type SearchValue = string | string[] | undefined;
type EnterPageProps = {
  searchParams: Promise<Record<string, SearchValue>>;
};

function firstValue(value: SearchValue) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export const metadata: Metadata = {
  manifest: "/api/schnellbestellung/manifest?v=2",
};

export default async function EnterPage({ searchParams }: EnterPageProps) {
  const params = await searchParams;
  const token = firstValue(params.t).trim();

  return <SchnellEnterClient token={token} />;
}
