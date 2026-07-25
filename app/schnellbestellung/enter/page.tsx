import type { Metadata } from "next";
import SchnellEnterClient from "@/components/schnellbestellung/SchnellEnterClient";

type SearchValue = string | string[] | undefined;
type EnterPageProps = {
  searchParams: Promise<Record<string, SearchValue>>;
};

function firstValue(value: SearchValue) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export async function generateMetadata({
  searchParams,
}: EnterPageProps): Promise<Metadata> {
  const params = await searchParams;
  const token = firstValue(params.t).trim();

  return {
    manifest: token
      ? `/api/schnellbestellung/manifest?t=${encodeURIComponent(token)}&v=1`
      : "/manifest-schnellbestellung.webmanifest?v=1",
  };
}

export default async function EnterPage({ searchParams }: EnterPageProps) {
  const params = await searchParams;
  const token = firstValue(params.t).trim();

  return <SchnellEnterClient token={token} />;
}
