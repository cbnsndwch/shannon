#!/usr/bin/env node
import { dispatch } from "./commands.js";

process.exitCode = await dispatch(process.argv.slice(2));
