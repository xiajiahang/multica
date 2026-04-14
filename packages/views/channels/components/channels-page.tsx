"use client";

import { useState } from "react";
import { ChannelList } from "./channel-list";
import { ChannelWindow } from "./channel-window";

export function ChannelsPage() {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  return (
    <div className="flex flex-1 min-h-0 h-full">
      {/* Sidebar */}
      <div className="w-64 shrink-0 border-r">
        <ChannelList
          selectedChannelId={selectedChannelId}
          onSelectChannel={setSelectedChannelId}
        />
      </div>
      {/* Main content */}
      <div className="flex-1 min-h-0">
        <ChannelWindow
          channelId={selectedChannelId}
          onClose={() => setSelectedChannelId(null)}
        />
      </div>
    </div>
  );
}
