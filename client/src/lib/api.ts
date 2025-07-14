import { apiRequest } from "./queryClient";

export interface DashboardStats {
  activeSyncs: number;
  conflicts: number;
  lastSync: string | null;
  recordsSynced: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const res = await apiRequest("GET", "/api/dashboard/stats");
  return res.json();
}

export async function syncPairNow(syncPairId: number) {
  const res = await apiRequest("POST", `/api/sync-pairs/${syncPairId}/sync`);
  return res.json();
}

export async function resolveConflict(conflictId: number, resolution: "affinity" | "notion") {
  const res = await apiRequest("POST", `/api/conflicts/${conflictId}/resolve`, { resolution });
  return res.json();
}

export async function deleteConflict(conflictId: number) {
  const res = await apiRequest("DELETE", `/api/conflicts/${conflictId}`);
  return res.json();
}

export async function deleteSyncPair(syncPairId: number) {
  const res = await apiRequest("DELETE", `/api/sync-pairs/${syncPairId}`);
  return res.json();
}

export async function createSyncPair(data: any) {
  const res = await apiRequest("POST", "/api/sync-pairs", data);
  return res.json();
}

export async function updateSyncPair(id: number, data: any) {
  const res = await apiRequest("PUT", `/api/sync-pairs/${id}`, data);
  return res.json();
}
