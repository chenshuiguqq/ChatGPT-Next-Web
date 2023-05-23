import { supabaseClient } from "../components/embeddings-supabase";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// if (!process.env.OPENAI_API_KEY) {
//   throw new Error("Missing env var from OpenAI");
// }

export const config = {
  runtime: "edge",
};

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    console.log("req.method ", req.method);
    return new Response("ok", { headers: corsHeaders });
  }

  const { ans_prehandle } = (await req.json()) as {
    ans_prehandle?: string;
  };

  if (!ans_prehandle) {
    return new Response("No prompt in the request", { status: 400 });
  }

  const query = ans_prehandle;

  // OpenAI recommends replacing newlines with spaces for best results
  let input = query.replace(/\n/g, " ");
  // console.log("input: ", input);
  const regex = /--(.*?)---/g;
  let match_aids: string[] = [];
  let match_aids_origin: string[] = [];
  let match = regex.exec(input);

  if (match != null) {
    return new Response(match[1]);
  }
  while (match !== null) {
    match_aids_origin.push(match[0]);
    match_aids.push(match[1]);
    console.log(match[1]); // 输出 test
    match = regex.exec(input);
  }

  const no_price_text = "无竞价信息";
  if (match_aids.length == 0) {
    return new Response(no_price_text, { headers: corsHeaders });
  }
  const { data: documents, error } = await supabaseClient
    .from("ad_info")
    .select("*")
    .eq("aid", match_aids[0]);

  if (error) console.error(error);

  let contextText = "";
  if (documents == null) {
    return new Response(no_price_text, { headers: corsHeaders });
  }
  // console.log("documents: ", documents);
  // const infos  = documents as Data[];
  const len = documents.length;
  // Concat matched documents
  if (documents) {
    for (let i = 0; i < documents.length; i++) {
      const document = documents[i];
      const aid = document.aid;
      const amount_from = document.amount_from;
      const amount_to = document.amount_to;
      const price = document.price;
      // Limit context to max 1500 tokens (configurable)
      // if (tokenCount > 1500) {
      //   break;
      // }
      input = input.replace(match_aids_origin[0], match_aids[0]);
      input = input.replace("{amount}", `${amount_from}-${amount_to}`);
      input = input.replace("{price}", `${price}`);
      contextText = input;
    }
  }

  console.log("contextText: ", contextText);

  return new Response(contextText);
};

export default handler;
