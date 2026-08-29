# Incident review — public-hadoop

**Root cause:** Dns failure  
**Onset:** 2015-10-18T18:04:11Z

## Summary

A Hadoop MapReduce job experienced network connectivity failures starting around 18:04 on 2015-10-18. Task attempts failed with NoRouteToHostException when trying to reach msra-sa-41:9000, and the RMCommunicator repeatedly failed to contact the Resource Manager. Multiple address change warnings indicate DNS resolution was returning different results (hostname vs IP address), suggesting DNS instability or failure.

## What happened

- At 18:04:11, the system logged an error about an unknown container, indicating early signs of communication problems.

> `hadoop.log:668`  
> `2015-10-18 18:04:11,034 ERROR [RMCommunicator Allocator] org.apache.hadoop.mapreduce.v2.app.rm.RMContainerAllocator: Container complete event for unknown container id container_1445144423722_0020_01_000012`

- At 18:05:27, the first address change warning appeared, showing DNS was resolving msra-sa-41 inconsistently between hostname and IP address.

> `hadoop.log:848`  
> `2015-10-18 18:05:27,570 WARN [LeaseRenewer:msrabi@msra-sa-41:9000] org.apache.hadoop.ipc.Client: Address change detected. Old: msra-sa-41/10.190.173.170:9000 New: msra-sa-41:9000`

- At 18:06:22, the RMCommunicator began reporting errors contacting the Resource Manager, indicating widespread connectivity issues.

> `hadoop.log:1006`  
> `2015-10-18 18:06:22,092 ERROR [RMCommunicator Allocator] org.apache.hadoop.mapreduce.v2.app.rm.RMContainerAllocator: ERROR IN CONTACTING RM.`

- At 18:06:26, task attempts began failing with NoRouteToHostException on socket timeout, unable to reach msra-sa-41:9000.

> `hadoop.log:1020`  
> `2015-10-18 18:06:26,029 FATAL [IPC Server handler 13 on 62270] org.apache.hadoop.mapred.TaskAttemptListenerImpl: Task: attempt_1445144423722_0020_m_000002_0 - exited : java.net.NoRouteToHostException: No Route to Host from  MININT-FNANLI5/127.0.0.1 to msra-sa-41:9000 failed on socket timeout exception: java.net.NoRouteToHostException: No route to host: no further information; For more details see:  http://wiki.apache.org/hadoop/NoRouteToHost`

- The LeaseRenewer continued failing to renew leases with increasing duration, reaching 328 seconds by 18:10:26.

> `hadoop.log:1899`  
> `2015-10-18 18:10:26,044 WARN [LeaseRenewer:msrabi@msra-sa-41:9000] org.apache.hadoop.hdfs.LeaseRenewer: Failed to renew lease for [DFSClient_NONMAPREDUCE_1537864556_1] for 328 seconds.  Will retry shortly ...`

## Why this is the cause

- Multiple address change warnings show DNS resolution was unstable, alternating between returning the hostname and IP address for msra-sa-41.

> `hadoop.log:848`  
> `2015-10-18 18:05:27,570 WARN [LeaseRenewer:msrabi@msra-sa-41:9000] org.apache.hadoop.ipc.Client: Address change detected. Old: msra-sa-41/10.190.173.170:9000 New: msra-sa-41:9000`
> `hadoop.log:1153`  
> `2015-10-18 18:06:52,203 WARN [LeaseRenewer:msrabi@msra-sa-41:9000] org.apache.hadoop.ipc.Client: Address change detected. Old: msra-sa-41/10.190.173.170:9000 New: msra-sa-41:9000`
> `hadoop.log:1246`  
> `2015-10-18 18:07:19,189 WARN [RMCommunicator Allocator] org.apache.hadoop.ipc.Client: Address change detected. Old: msra-sa-41/10.190.173.170:8030 New: msra-sa-41:8030`

- Task attempts failed with NoRouteToHostException, a network-level error indicating the system could not establish a route to the target host.

> `hadoop.log:1020`  
> `2015-10-18 18:06:26,029 FATAL [IPC Server handler 13 on 62270] org.apache.hadoop.mapred.TaskAttemptListenerImpl: Task: attempt_1445144423722_0020_m_000002_0 - exited : java.net.NoRouteToHostException: No Route to Host from  MININT-FNANLI5/127.0.0.1 to msra-sa-41:9000 failed on socket timeout exception: java.net.NoRouteToHostException: No route to host: no further information; For more details see:  http://wiki.apache.org/hadoop/NoRouteToHost`
> `hadoop.log:1053`  
> `2015-10-18 18:06:28,217 FATAL [IPC Server handler 4 on 62270] org.apache.hadoop.mapred.TaskAttemptListenerImpl: Task: attempt_1445144423722_0020_m_000001_0 - exited : java.net.NoRouteToHostException: No Route to Host from  MININT-FNANLI5/127.0.0.1 to msra-sa-41:9000 failed on socket timeout exception: java.net.NoRouteToHostException: No route to host: no further information; For more details see:  http://wiki.apache.org/hadoop/NoRouteToHost`

- The pattern of address changes combined with NoRouteToHost errors indicates DNS was either failing to resolve or returning incorrect/inconsistent results, preventing proper network routing.

> `hadoop.log:915`  
> `2015-10-18 18:05:58,722 WARN [LeaseRenewer:msrabi@msra-sa-41:9000] org.apache.hadoop.ipc.Client: Address change detected. Old: msra-sa-41/10.190.173.170:9000 New: msra-sa-41:9000`
> `hadoop.log:1021`  
> `2015-10-18 18:06:26,029 INFO [IPC Server handler 13 on 62270] org.apache.hadoop.mapred.TaskAttemptListenerImpl: Diagnostics report from attempt_1445144423722_0020_m_000002_0: Error: java.net.NoRouteToHostException: No Route to Host from  MININT-FNANLI5/127.0.0.1 to msra-sa-41:9000 failed on socket timeout exception: java.net.NoRouteToHostException: No route to host: no further information; For more details see:  http://wiki.apache.org/hadoop/NoRouteToHost`

## Considered and ruled out

- Resource exhaustion is ruled out because there are no memory, CPU, or thread pool exhaustion errors; the failures are specifically network connectivity issues.

> `hadoop.log:1020`  
> `2015-10-18 18:06:26,029 FATAL [IPC Server handler 13 on 62270] org.apache.hadoop.mapred.TaskAttemptListenerImpl: Task: attempt_1445144423722_0020_m_000002_0 - exited : java.net.NoRouteToHostException: No Route to Host from  MININT-FNANLI5/127.0.0.1 to msra-sa-41:9000 failed on socket timeout exception: java.net.NoRouteToHostException: No route to host: no further information; For more details see:  http://wiki.apache.org/hadoop/NoRouteToHost`

- Downstream dependency failure is ruled out because the errors show the client cannot reach the server at the network level (NoRouteToHost), not that the server is down or returning errors.

> `hadoop.log:1021`  
> `2015-10-18 18:06:26,029 INFO [IPC Server handler 13 on 62270] org.apache.hadoop.mapred.TaskAttemptListenerImpl: Diagnostics report from attempt_1445144423722_0020_m_000002_0: Error: java.net.NoRouteToHostException: No Route to Host from  MININT-FNANLI5/127.0.0.1 to msra-sa-41:9000 failed on socket timeout exception: java.net.NoRouteToHostException: No route to host: no further information; For more details see:  http://wiki.apache.org/hadoop/NoRouteToHost`

- Configuration change is ruled out because the address change warnings show the system detecting changes it did not initiate, and the pattern is consistent with DNS instability rather than a deliberate reconfiguration.

> `hadoop.log:848`  
> `2015-10-18 18:05:27,570 WARN [LeaseRenewer:msrabi@msra-sa-41:9000] org.apache.hadoop.ipc.Client: Address change detected. Old: msra-sa-41/10.190.173.170:9000 New: msra-sa-41:9000`

## Action items

- [ ] Investigate DNS server logs and configuration for msra-sa-41 around 18:04-18:10 on 2015-10-18 to identify the root cause of resolution instability
- [ ] Implement DNS caching with appropriate TTL settings to reduce impact of transient DNS failures
- [ ] Add monitoring and alerting for DNS resolution failures and address change events
- [ ] Consider using IP addresses directly in critical Hadoop configuration to bypass DNS for core infrastructure components
- [ ] Review network routing configuration between MININT-FNANLI5 and msra-sa-41 to ensure proper routing tables
- [ ] Implement retry logic with exponential backoff for DNS resolution failures in Hadoop client code

---

_Drafted by the cited-RCA workflow. Every quote above was copied from the_
_line it names and checked against the incident bundle before publication._
