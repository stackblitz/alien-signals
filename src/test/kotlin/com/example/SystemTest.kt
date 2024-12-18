package com.example

import kotlin.test.Test
import kotlin.test.assertEquals

class SystemTest {

    @Test
    fun testPropagate() {
        val signal1 = Signal(1)
        val signal2 = Signal(2)
        val signal3 = Signal(3)

        val effect1 = Effect { signal1.get() + signal2.get() }
        val effect2 = Effect { signal2.get() + signal3.get() }

        signal1.set(10)
        signal2.set(20)
        signal3.set(30)

        assertEquals(30, effect1.run())
        assertEquals(50, effect2.run())
    }

    @Test
    fun testCheckDirty() {
        val signal1 = Signal(1)
        val signal2 = Signal(2)
        val signal3 = Signal(3)

        val computed1 = Computed { signal1.get() + signal2.get() }
        val computed2 = Computed { signal2.get() + signal3.get() }

        signal1.set(10)
        signal2.set(20)
        signal3.set(30)

        assertEquals(30, computed1.get())
        assertEquals(50, computed2.get())
    }
}
