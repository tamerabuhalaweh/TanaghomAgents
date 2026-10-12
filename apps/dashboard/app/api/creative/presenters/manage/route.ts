import type {NextRequest} from 'next/server';
import {apiFailure} from '@/lib/server/responses';
import {managePresenter} from '@/lib/server/creative/avatar-governance';
export const runtime='nodejs';
export async function POST(request:NextRequest){try{return await managePresenter(request);}catch(error){return apiFailure(error);}}
