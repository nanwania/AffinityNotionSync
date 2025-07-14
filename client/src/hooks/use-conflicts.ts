import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Conflict } from "@shared/schema";
import { resolveConflict, deleteConflict } from "@/lib/api";

export function useConflicts(syncPairId?: number) {
  return useQuery<Conflict[]>({
    queryKey: ["/api/conflicts", syncPairId],
  });
}

export function usePendingConflicts(syncPairId?: number) {
  return useQuery<Conflict[]>({
    queryKey: ["/api/conflicts/pending", syncPairId],
  });
}

export function useResolveConflict() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, resolution }: { id: number; resolution: "affinity" | "notion" }) => 
      resolveConflict(id, resolution),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conflicts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conflicts/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });
}

export function useDeleteConflict() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: deleteConflict,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conflicts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conflicts/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });
}
