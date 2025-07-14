import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ApiSettingsProps {
  onConfigureWebhooks?: () => void;
}

export function ApiSettings({ onConfigureWebhooks }: ApiSettingsProps) {
  const { toast } = useToast();

  const { data: affinityRateLimit } = useQuery<{ used: number; remaining: number; reset: number }>({
    queryKey: ["/api/affinity/rate-limit"],
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const { data: notionDatabases } = useQuery<any[]>({
    queryKey: ["/api/notion/databases"],
  });

  const testConnection = async (service: "affinity" | "notion") => {
    try {
      if (service === "affinity") {
        await fetch("/api/affinity/lists");
      } else {
        await fetch("/api/notion/databases");
      }
      
      toast({
        title: "Connection Test",
        description: `${service} connection successful`,
      });
    } catch (error) {
      toast({
        title: "Connection Test",
        description: `${service} connection failed`,
        variant: "destructive",
      });
    }
  };

  const formatResetTime = (seconds: number) => {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    return `${Math.floor(seconds / 3600)} hours`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>API Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Affinity API */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h4 className="font-medium text-gray-900">Affinity API</h4>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Key Status
                </label>
                <div className="flex items-center space-x-2">
                  <Badge className="bg-green-100 text-green-800">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testConnection("affinity")}
                  >
                    Test Connection
                  </Button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rate Limit Status
                </label>
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Requests Used</span>
                    <span>{affinityRateLimit?.used || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Requests Remaining</span>
                    <span>{affinityRateLimit?.remaining || 900}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Reset Time</span>
                    <span>{formatResetTime(affinityRateLimit?.reset || 60)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Notion API */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                </svg>
              </div>
              <h4 className="font-medium text-gray-900">Notion API</h4>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Integration Status
                </label>
                <div className="flex items-center space-x-2">
                  <Badge className="bg-green-100 text-green-800">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testConnection("notion")}
                  >
                    Test Connection
                  </Button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Available Databases
                </label>
                <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                  {notionDatabases?.length ? (
                    notionDatabases.map((db) => (
                      <div key={db.id} className="flex justify-between text-sm">
                        <span>{db.title?.[0]?.text?.content || "Untitled"}</span>
                        <span className="text-green-600">✓</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-gray-500">No databases found</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <div className="flex justify-between items-center">
            <div>
              <h4 className="font-medium text-gray-900">Webhook Settings</h4>
              <p className="text-sm text-gray-500">Configure webhooks for real-time updates</p>
            </div>
            <Button onClick={onConfigureWebhooks}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Configure Webhooks
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
