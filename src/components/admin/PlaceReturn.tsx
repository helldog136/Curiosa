"use client";

import { createContext, useContext } from "react";

/**
 * (core 0.33.0) The address of the place page (or core page) that shows a module's blocks. The module's forms and row buttons read it and send it with the action, so a
 * `redirect: "?…"` answer comes back to THIS page. Absent on the module's own page: the answer then goes to the module page, as before.
 */
const PlaceReturnContext = createContext<string | null>(null);
export const PlaceReturnProvider = PlaceReturnContext.Provider;
export const usePlaceReturn = (): string | null => useContext(PlaceReturnContext);
