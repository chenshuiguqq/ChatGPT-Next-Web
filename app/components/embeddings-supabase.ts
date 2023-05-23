import { createClient } from "@supabase/supabase-js";

interface Client {
  url?: string;
  key?: string;
}

const client: Client = {
  url: "https://enbntbcaestutdjyjkgj.supabase.co",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYm50YmNhZXN0dXRkanlqa2dqIiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODQxMzgwNjEsImV4cCI6MTk5OTcxNDA2MX0.GBowSSxyoi7MPOpl0pZJ8R0kT95W77gqmwt5ebq1AB0",
};

if (!client.url || !client.key) {
  throw new Error("Missing Supabase credentials");
}

export const supabaseClient = createClient(client.url!, client.key!);
