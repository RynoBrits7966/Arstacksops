import type { User } from "../types";

interface UserPickerProps {
  users: User[];
  selectedIds: string[];
  onToggle: (user: User) => void;
  label: string;
}

export function UserPicker({ users, selectedIds, onToggle, label }: UserPickerProps) {
  return (
    <fieldset className="user-picker">
      <legend>{label}</legend>
      <div className="user-picks" role="list">
        {users.map((user) => {
          const selected = selectedIds.includes(user.id);
          return (
            <button
              key={user.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onToggle(user)}
            >
              @{user.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
