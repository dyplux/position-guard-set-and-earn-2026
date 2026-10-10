"""Private controlled, read-only setup bridge. Never reads wallet secrets."""
import sys,json,hashlib,datetime
from pathlib import Path
REPO=Path(__file__).resolve().parent
sys.path.insert(0,str(REPO))
from collector import collect, Reader, words, encoded, CONTROLLER
from keeper_plan import plan_native_setup,OWNER,MARKET
ROOT=Path(__file__).resolve().parent

def read_state():
    market_proof=json.loads((ROOT/'docs/core-market-source-2026-10-10.json').read_text())
    token_proof=json.loads((ROOT/'docs/vbnb-source-2026-10-10.json').read_text())
    if not market_proof['exact_runtime_match'] or not token_proof['exact_executable_bytes_match'] or not token_proof['only_bzzr1_digest_differs']:
        raise ValueError('SOURCE_CLASSIFICATION_STOP')
    snapshot=collect(OWNER)
    if snapshot['runtime_binding']['components']['market']['sha256']!=market_proof['actual_runtime_sha256']:raise ValueError('MARKET_PROOF_PIN_CONFLICT')
    if snapshot['source_kind']!='OBSERVED' or snapshot['vai_repay_amount_mantissa']!='0':raise ValueError('SNAPSHOT_SCOPE_STOP')
    reader=Reader();block=hex(snapshot['block_number'])
    code,comp,snap,native,owner=reader.batch([
        ('eth_getCode',[MARKET,block]),
        ('eth_call',[{'to':MARKET,'data':'0x5fe3b567'},block]),
        ('eth_call',[{'to':MARKET,'data':encoded('getAccountSnapshot(address)',OWNER)},block]),
        ('eth_getBalance',[OWNER,block]),
        ('eth_call',[{'to':'0x8004A818BFB912233c491871b3d84c89A494BD9e','data':'0x6352211e'+format(2583,'064x')},block])])
    if hashlib.sha256(bytes.fromhex(code[2:])).hexdigest()!=token_proof['whole_actual_runtime_pin']:raise ValueError('VTOKEN_RUNTIME_CHANGED')
    if len(words(comp))!=1 or words(comp)[0]!=int(CONTROLLER[2:],16):raise ValueError('VTOKEN_CONTROLLER_CHANGED')
    if len(words(owner))!=1 or words(owner)[0]!=int(OWNER[2:],16):raise ValueError('REGISTERED_OWNER_CHANGED')
    values=words(snap)
    if len(values)!=4 or values[0]!=0:raise ValueError('VTOKEN_SNAPSHOT_STOP')
    entered_raw=reader.call('eth_call',[{'to':CONTROLLER,'data':encoded('getAssetsIn(address)',OWNER)},block])
    from collector import address_array
    entered=[MARKET if a.lower()==MARKET.lower() else a for a in address_array(entered_raw)]
    end=reader.call('eth_getBlockByNumber',[block,False])
    if end['hash']!=snapshot['block_hash']:raise ValueError('BLOCK_CHANGED')
    state={'owner':OWNER,'chain_id':97,'vtoken_address':MARKET,'controller':CONTROLLER,'actual_source_verified':True,'complete_position':True,
      'block_number':snapshot['block_number'],'block_hash':snapshot['block_hash'],'timestamp':snapshot['block_timestamp'],
      'native_balance_wei':str(int(native,16)),'vtoken_balance_raw':str(values[1]),'borrow_balance_raw':str(values[2]),'vai_debt_raw':'0','entered_markets':entered,
      'source_classification':'CORE_MARKET_FULL_MATCH; VBNB_EXECUTABLE_EXACT_WITH_METADATA_DIGEST_DIFFERENCE','source_snapshot':snapshot}
    return state
if __name__=='__main__':
    state=read_state();plan=plan_native_setup(state,trusted_reader=True);output={'state':state,'plan':plan,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'signatures':0,'transactions':0}
    print(json.dumps(output,indent=2))
