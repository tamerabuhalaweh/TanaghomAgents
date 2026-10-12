import type {NextRequest} from "next/server";
import {apiFailure} from "@/lib/server/responses";
import {submitPresenter} from "@/lib/server/creative/presenters";
export const runtime="nodejs";
export async function POST(request:NextRequest){try{return await submitPresenter(request);}catch(error){return apiFailure(error);}}
