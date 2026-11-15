
import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";


export async function GET() {
  try {
    const { error } = await supabaseServer
      .from("brands")
      .select("id")
      .limit(1);

    if (error) {
      console.error("Supabase connection test failed:", error.message);

      return NextResponse.json(
        { connected: false, message: "Supabase query failed." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      connected: true,
      message: "Supabase connection successful.",
    });
  } catch (error) {
    console.error("Supabase connection test error:", error);

    return NextResponse.json(
      { connected: false, message: "Unable to connect to Supabase." },
      { status: 500 },
    );
  }
}
