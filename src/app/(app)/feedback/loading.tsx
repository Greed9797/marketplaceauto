import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function FeedbackLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-48" />
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-60" />
          <Skeleton className="mt-2 h-3 w-80" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-32 w-full" />
          </div>
          <Skeleton className="h-10 w-32" />
        </CardContent>
      </Card>
    </div>
  );
}
