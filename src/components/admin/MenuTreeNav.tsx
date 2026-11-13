import type { ReactNode } from "react";
import { NavGroup } from "./NavGroup";
import { groupStateId, nodeEntries, type MenuNode, type TreeItem } from "@/core/modules/menuPath";
import type { NavState } from "@/core/modules/menuPlacement";

/**
 * The groups that modules declare with `adminMenu` (core 0.13.0): one collapsible group per path segment, entries inside the last one.
 * The group that holds the current page opens by itself (NavGroup); the others follow the remembered state, closed by default.
 * Server component: only NavGroup and the entry links are client code.
 */
export function MenuTreeNav<T extends TreeItem>({ node, state, targets, renderEntry, badgeLabel, depth = 0 }: { node: MenuNode<T>; state: NavState; targets: (item: T) => string[]; renderEntry: (item: T) => ReactNode; badgeLabel: string; depth?: number }) {
  const id = groupStateId(node.path);
  return (
    <NavGroup id={id} title={node.title} icon={node.icon} tree targets={nodeEntries(node).flatMap(targets)} stored={state[id]} openByDefault={false} badge={node.badge} badgeLabel={badgeLabel}>
      <div data-testid={`nav-tree-${node.path.join(".")}`} data-depth={depth}>
        {node.entries.map(renderEntry)}
        {node.children.map((c) => <MenuTreeNav key={c.id} node={c} state={state} targets={targets} renderEntry={renderEntry} badgeLabel={badgeLabel} depth={depth + 1} />)}
      </div>
    </NavGroup>
  );
}
