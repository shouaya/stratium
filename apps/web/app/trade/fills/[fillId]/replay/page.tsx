import { PositionReplayPage } from "../../../../position-replay-page";

export default async function TradeFillReplayRoutePage({
  params
}: {
  params: Promise<{ fillId: string }>;
}) {
  const { fillId } = await params;

  return <PositionReplayPage fillId={fillId} />;
}
