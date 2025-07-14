import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SyncPair } from "@shared/schema";
import { createSyncPair, updateSyncPair, deleteSyncPair, syncPairNow } from "@/lib/api";

export function useSyncPairs() {
  return useQuery<SyncPair[]>({
    queryKey: ["/api/sync-pairs"],
  });
}

export function useCreateSyncPair() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: createSyncPair,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sync-pairs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });
}

export function useUpdateSyncPair() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateSyncPair(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sync-pairs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });
}

export function useDeleteSyncPair() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: deleteSyncPair,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sync-pairs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });
}

export function useSyncPairNow() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: syncPairNow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sync-pairs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sync-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });
}
