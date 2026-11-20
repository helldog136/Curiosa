---- MODULE MaintenanceLock ----
\* Formal review of the maintenance lock and of closeInterrupted (src/core/maintenance/background.ts, core 0.46.0, commit 57236d6).
\* Time is counted in ticks: Stale stands for LOCK_STALE_MS (30 min) and Interrupted for INTERRUPTED_AFTER_MS (2 min).
\* One site = ONE server process (the lock and the set of running work live in memory of that process): see docs/formal/maintenance-lock.md for what that assumes.
EXTENDS Naturals, FiniteSets

CONSTANTS Ops,          \* the maintenance operations that may be asked (one-shot each)
          Stale,        \* ticks after which a held lock is ignored            (currentLock: now - since > LOCK_STALE_MS)
          Interrupted,  \* ticks after which a "running" record with no work behind it is closed (closeInterrupted)
          MaxT,         \* the clock stops here (finite model)
          StaleRule,    \* TRUE: the code as it is (a stale lock is ignored). FALSE: a lock is held until released.
          Lease,        \* TRUE: the proposed fix (work that makes progress renews `since`). FALSE: the code as it is.
          InlineOps     \* operations that do NOT register in active() (level 3 actions that are not in BACKGROUND_LEVEL3)

VARIABLES clock, lock, since, exec, hung, active, rec, startAt
vars == <<clock, lock, since, exec, hung, active, rec, startAt>>

None == "none"

TypeOK == /\ clock \in 0..MaxT
          /\ lock \in Ops \cup {None}
          /\ since \in 0..MaxT
          /\ exec \subseteq Ops
          /\ hung \subseteq exec
          /\ active \subseteq Ops
          /\ rec \in [Ops -> {"none", "running", "done", "interrupted"}]
          /\ startAt \in [Ops -> 0..MaxT]

Init == /\ clock = 0 /\ lock = None /\ since = 0
        /\ exec = {} /\ hung = {} /\ active = {}
        /\ rec = [o \in Ops |-> "none"] /\ startAt = [o \in Ops |-> 0]

\* currentLock(): a lock older than LOCK_STALE_MS does not count.
LockFree == lock = None \/ (StaleRule /\ clock - since > Stale)

\* takeLock + openRun + runInBackground (active().add): the work starts. The lock is taken only when free.
Start(o) == /\ rec[o] = "none" /\ LockFree
            /\ lock' = o /\ since' = clock
            /\ exec' = exec \cup {o}
            /\ rec' = [rec EXCEPT ![o] = "running"] /\ startAt' = [startAt EXCEPT ![o] = clock]
            /\ active' = IF o \in InlineOps THEN active ELSE active \cup {o}
            /\ UNCHANGED <<clock, hung>>

\* The work ends: `release` gives the lock back only if it is still the caller's own (g.curiosaMaintenanceBusy === mine), then the record is closed (finish overwrites whatever it said).
Finish(o) == /\ o \in exec /\ o \notin hung
             /\ exec' = exec \ {o} /\ active' = active \ {o}
             /\ lock' = IF lock = o THEN None ELSE lock
             /\ rec' = [rec EXCEPT ![o] = "done"]
             /\ UNCHANGED <<clock, since, hung, startAt>>

\* The environment: a piece of work that never returns (a download that hangs forever).
Hang(o) == /\ o \in exec /\ o \notin hung
           /\ hung' = hung \cup {o}
           /\ UNCHANGED <<clock, lock, since, exec, active, rec, startAt>>

\* Time passes. With Lease, the work that is alive (not hung) renews its claim on the lock at each tick (the proposed fix).
Tick == /\ clock < MaxT
        /\ clock' = clock + 1
        /\ since' = IF Lease /\ lock \in exec /\ lock \notin hung THEN clock + 1 ELSE since
        /\ UNCHANGED <<lock, exec, hung, active, rec, startAt>>

\* closeInterrupted(): a "running" record that no work registered in active() stands behind, and older than INTERRUPTED_AFTER_MS, is closed as interrupted.
Sweep(o) == /\ rec[o] = "running" /\ o \notin active /\ clock - startAt[o] >= Interrupted
            /\ rec' = [rec EXCEPT ![o] = "interrupted"]
            /\ UNCHANGED <<clock, lock, since, exec, hung, active, startAt>>

\* The server restarts: the in-memory lock and the running work are gone, the records stay.
Restart == /\ exec' = {} /\ hung' = {} /\ active' = {} /\ lock' = None
           /\ UNCHANGED <<clock, since, rec, startAt>>

Next == \/ \E o \in Ops : Start(o) \/ Finish(o) \/ Hang(o) \/ Sweep(o)
        \/ Tick \/ Restart

Spec == Init /\ [][Next]_vars

\* ---- Properties ----
\* M1: one maintenance operation at a time. "Live" = alive and not hung: a hung one is dead in effect, and the stale rule exists for it.
AtMostOneLive == Cardinality(exec \ hung) <= 1

\* M2: a record is never closed as "interrupted" while the work behind it is alive (before its result arrives).
NoFalseInterrupt == \A o \in Ops : rec[o] = "interrupted" => o \notin (exec \ hung)

\* M3: no record is closed as "done" while its work is not finished (sanity of the model: finish is the only way to "done").
DoneMeansFinished == \A o \in Ops : rec[o] = "done" => o \notin exec

\* ---- Anti-vacuity: each of these is expected to be VIOLATED (the situation is reachable) ----
NeverTwoStarted == Cardinality({o \in Ops : rec[o] /= "none"}) < 2
NeverLiveWork == Cardinality(exec \ hung) = 0
NeverInterrupted == \A o \in Ops : rec[o] /= "interrupted"
\* With no stale rule a hung holder blocks everyone for ever: expected VIOLATED only when StaleRule = FALSE (the witness that the rule is needed).
NeverStuck == ~(lock /= None /\ lock \in hung /\ clock - since > Stale /\ ~LockFree)
====
