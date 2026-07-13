export interface FriendContact {
  id: string;
  name: string;
  status: string;
  incoming: boolean;
}

interface SocialPanelProps {
  friends: FriendContact[];
  username: string;
  message: string;
  canVisitCamps: boolean;
  onUsernameChange: (username: string) => void;
  onAddFriend: () => void;
  onAcceptFriend: (id: string) => void;
  onRemoveFriend: (id: string) => void;
  onVisitCamp: (id: string) => void;
}

export function SocialPanel({
  friends,
  username,
  message,
  canVisitCamps,
  onUsernameChange,
  onAddFriend,
  onAcceptFriend,
  onRemoveFriend,
  onVisitCamp,
}: SocialPanelProps) {
  return (
    <div className="panel social-panel">
      <h3>CONTACTS<span className="sub">P to close</span></h3>
      <div className="friend-add">
        <input
          placeholder="friend's callsign"
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onAddFriend();
            event.stopPropagation();
          }}
        />
        <button onClick={onAddFriend}>ADD</button>
      </div>
      <div className="friend-msg">{message}</div>
      {friends.length === 0 && <div className="item-desc">No contacts yet. Friends show up green on your map.</div>}
      {friends.map((friend) => (
        <div className="friend-row" key={friend.id}>
          <span className={`f-dot ${friend.status}`} />
          <span className="f-name">{friend.name}</span>
          <span className="f-status">{friend.status === 'accepted' ? 'ally' : friend.incoming ? 'wants to ally' : 'pending'}</span>
          {friend.status === 'accepted' && canVisitCamps && <button onClick={() => onVisitCamp(friend.id)}>VISIT CAMP</button>}
          {friend.status !== 'accepted' && friend.incoming && <button onClick={() => onAcceptFriend(friend.id)}>ACCEPT</button>}
          {friend.status !== 'accepted' && friend.incoming && <button className="f-remove" onClick={() => onRemoveFriend(friend.id)}>DECLINE</button>}
          {friend.status !== 'accepted' && !friend.incoming && <button className="f-remove" onClick={() => onRemoveFriend(friend.id)}>CANCEL</button>}
          {friend.status === 'accepted' && <button className="f-remove" onClick={() => onRemoveFriend(friend.id)}>REMOVE</button>}
        </div>
      ))}
    </div>
  );
}
