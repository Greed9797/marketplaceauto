import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ConnectorsSelectLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="min-h-[160px]">
            <CardHeader>
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-md" />
                <Skeleton className="h-5 w-28" />
              </div>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
