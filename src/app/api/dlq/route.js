import { 
  getDlqEntries, 
  getDlqEntryById, 
  deleteDlqEntry, 
  clearDlq, 
  getDlqStats,
  pruneOldEntries
} from "@/lib/dlqDb.js";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  
  const filter = {
    status: searchParams.get("status"),
    provider: searchParams.get("provider"),
    model: searchParams.get("model"),
    comboName: searchParams.get("comboName"),
    since: searchParams.get("since")
  };

  const limit = parseInt(searchParams.get("limit") || "100", 10);

  try {
    if (searchParams.get("stats") === "true") {
      const stats = await getDlqStats();
      return Response.json({ stats });
    }

    let entries = await getDlqEntries(filter);
    entries = entries.slice(0, limit);

    return Response.json({ entries, total: entries.length });
  } catch (error) {
    console.error("[DLQ API] Error fetching entries:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  
  const id = searchParams.get("id");
  const clearAll = searchParams.get("all") === "true";
  const provider = searchParams.get("provider");

  try {
    if (id) {
      const deleted = await deleteDlqEntry(id);
      return Response.json({ deleted });
    }

    if (clearAll) {
      const filter = provider ? { provider } : {};
      const count = await clearDlq(filter);
      return Response.json({ cleared: count });
    }

    const pruned = await pruneOldEntries();
    return Response.json({ pruned });
  } catch (error) {
    console.error("[DLQ API] Error deleting entries:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
