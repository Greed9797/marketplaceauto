import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-32" />
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="flex items-center justify-between" key={i}>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-44" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
