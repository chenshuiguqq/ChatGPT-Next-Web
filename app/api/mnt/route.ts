import { NextRequest, NextResponse } from "next/server";

async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  let { logTitle } = await req.json();
  console.log(logTitle + ":" + new Date().toISOString());

  return NextResponse.json({ body: "OK" }, { status: 200 });
}

export const POST = handle;
export const GET = handle;
export const OPTIONS = handle;

export const runtime = "nodejs";
