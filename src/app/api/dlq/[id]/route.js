import { 
  getDlqEntryById, 
  updateDlqEntry, 
  deleteDlqEntry, 
  retryDlqEntry,
  incrementDlqFailure 
} from "@/lib/dlqDb.js";

import { getProviderConnections, updateProviderConnection } from "@/lib/localDb.js";

export async function GET(request, { params }) {
  const { id } = params;

  try {
    const entry = await getDlqEntryById(id);
    
    if (!entry) {
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }

    return Response.json({ entry });
  } catch (error) {
    console.error("[DLQ API] Error fetching entry:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const { id } = params;

  try {
    const entry = await getDlqEntryById(id);
    
    if (!entry) {
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }

    const result = await retryDlqEntry(id);
    
    return Response.json({ 
      success: result.success, 
      entry: result.entry,
      message: result.success 
        ? "Entry marked for retry" 
        : result.error 
    });
  } catch (error) {
    console.error("[DLQ API] Error retrying entry:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const { id } = params;

  try {
    const deleted = await deleteDlqEntry(id);
    
    if (!deleted) {
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }

    return Response.json({ deleted: true });
  } catch (error) {
    console.error("[DLQ API] Error deleting entry:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
