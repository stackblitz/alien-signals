package alien.signals

fun propagate(subs: List<Subscriber>, targetFlag: Int = DIRTY) {
    var link = subs
    var stack = 0
    var nextSub: List<Subscriber>? = null

    top@ do {
        val sub = link.sub
        val subFlags = sub.flags

        if (subFlags and TRACKING == 0) {
            var canPropagate = subFlags shr 2 == 0
            if (!canPropagate && subFlags and CAN_PROPAGATE != 0) {
                sub.flags = sub.flags and CAN_PROPAGATE.inv()
                canPropagate = true
            }
            if (canPropagate) {
                sub.flags = sub.flags or targetFlag
                val subSubs = (sub as Dependency).subs
                if (subSubs != null) {
                    if (subSubs.nextSub != null) {
                        subSubs.prevSub = subs
                        link = subs = subSubs
                        targetFlag = TO_CHECK_DIRTY
                        stack++
                    } else {
                        link = subSubs
                        targetFlag = if (sub is Effect) RUN_INNER_EFFECTS else TO_CHECK_DIRTY
                    }
                    continue
                }
                if (sub is Effect) {
                    if (queuedEffectsTail != null) {
                        queuedEffectsTail!!.nextNotify = sub
                    } else {
                        queuedEffects = sub
                    }
                    queuedEffectsTail = sub
                }
            } else if (sub.flags and targetFlag == 0) {
                sub.flags = sub.flags or targetFlag
            }
        } else if (isValidLink(link, sub)) {
            if (subFlags shr 2 == 0) {
                sub.flags = sub.flags or targetFlag or CAN_PROPAGATE
                val subSubs = (sub as Dependency).subs
                if (subSubs != null) {
                    if (subSubs.nextSub != null) {
                        subSubs.prevSub = subs
                        link = subs = subSubs
                        targetFlag = TO_CHECK_DIRTY
                        stack++
                    } else {
                        link = subSubs
                        targetFlag = if (sub is Effect) RUN_INNER_EFFECTS else TO_CHECK_DIRTY
                    }
                    continue
                }
            } else if (sub.flags and targetFlag == 0) {
                sub.flags = sub.flags or targetFlag
            }
        }

        if (subs.nextSub == null) {
            if (stack > 0) {
                var dep = subs.dep
                do {
                    stack--
                    val depSubs = dep.subs!!
                    val prevLink = depSubs.prevSub!!
                    depSubs.prevSub = null
                    link = subs = prevLink.nextSub!!
                    if (subs != null) {
                        targetFlag = if (stack > 0) TO_CHECK_DIRTY else DIRTY
                        continue@top
                    }
                    dep = prevLink.dep
                } while (stack > 0)
            }
            break
        }
        if (link != subs) {
            targetFlag = if (stack > 0) TO_CHECK_DIRTY else DIRTY
        }
        link = subs = subs.nextSub!!
    } while (true)

    if (batchDepth == 0) {
        drainQueuedEffects()
    }
}

fun checkDirty(deps: List<Dependency>): Boolean {
    var stack = 0
    var dirty: Boolean
    var nextDep: List<Dependency>? = null

    top@ do {
        dirty = false
        val dep = deps.dep
        if (dep is Computed<*>) {
            if (dep.version != deps.version) {
                dirty = true
            } else {
                val depFlags = dep.flags
                if (depFlags and DIRTY != 0) {
                    dirty = dep.update()
                } else if (depFlags and TO_CHECK_DIRTY != 0) {
                    dep.subs!!.prevSub = deps
                    deps = dep.deps!!
                    stack++
                    continue
                }
            }
        }
        if (dirty || deps.nextDep == null) {
            if (stack > 0) {
                var sub = deps.sub as Computed<*>
                do {
                    stack--
                    val subSubs = sub.subs!!
                    val prevLink = subSubs.prevSub!!
                    subSubs.prevSub = null
                    if (dirty) {
                        if (sub.update()) {
                            sub = prevLink.sub as Computed<*>
                            dirty = true
                            continue
                        }
                    } else {
                        sub.flags = sub.flags and TO_CHECK_DIRTY.inv()
                    }
                    deps = prevLink.nextDep!!
                    if (deps != null) {
                        continue@top
                    }
                    sub = prevLink.sub as Computed<*>
                    dirty = false
                } while (stack > 0)
            }
            return dirty
        }
        deps = deps.nextDep!!
    } while (true)
}

const val DIRTY = 1 shl 4
const val TO_CHECK_DIRTY = 1 shl 3
const val TRACKING = 1 shl 0
const val CAN_PROPAGATE = 1 shl 1
const val RUN_INNER_EFFECTS = 1 shl 2

var batchDepth = 0
var queuedEffects: Effect<*>? = null
var queuedEffectsTail: Effect<*>? = null

fun drainQueuedEffects() {
    while (queuedEffects != null) {
        val effect = queuedEffects
        val queuedNext = effect!!.nextNotify
        if (queuedNext != null) {
            effect.nextNotify = null
            queuedEffects = queuedNext
        } else {
            queuedEffects = null
            queuedEffectsTail = null
        }
        effect.notify()
    }
}

fun isValidLink(subLink: List<Dependency>, sub: Subscriber): Boolean {
    val depsTail = sub.depsTail
    if (depsTail != null) {
        var link = sub.deps!!
        do {
            if (link == subLink) {
                return true
            }
            if (link == depsTail) {
                break
            }
            link = link.nextDep!!
        } while (link != null)
    }
    return false
}
