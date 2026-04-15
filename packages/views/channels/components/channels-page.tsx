"use client";

import { useState } from "react";
import { ChannelList } from "./channel-list";
import { ChannelWindow } from "./channel-window";
import { CreateChannelDialog } from "./create-channel-dialog";

export function ChannelsPage() {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const handleCreateSuccess = (channelId: string) => {
    setSelectedChannelId(channelId);
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 shrink-0 border-r overflow-hidden">
        <ChannelList
          selectedChannelId={selectedChannelId}
          onSelectChannel={setSelectedChannelId}
          onCreateChannel={() => setCreateOpen(true)}
        />
      </div>
      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        <ChannelWindow
          channelId={selectedChannelId}
          onClose={() => setSelectedChannelId(null)}
        />
      </div>
      {/* Create dialog */}
      <CreateChannelDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
