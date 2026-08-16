// TEMPORARY TEST ROUTE — delete this file after testing.
// Create this at: app/api/test-provision/route.js

import { provisionAccount } from "@/lib/centova";

export async function GET() {
  try {
    const testUsername = "testuser" + Date.now().toString().slice(-5);

    const result = await provisionAccount({
      username: testUsername,
      adminpassword: "TestPass123!",
      sourcepassword: "SourcePass123!",
      hostname: "test.ruvanas.example.com",
      title: "Test Radio Account"
    });

    return Response.json({ success: true, result });
  } catch (err) {
    return Response.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
